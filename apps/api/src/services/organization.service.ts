import {
  type Organization,
  type OrgMemberRole,
  type CreateOrganizationDto,
  type UpdateOrganizationDto,
} from "@teranga/shared-types";
import { organizationRepository } from "@/repositories/organization.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { auth, db, COLLECTIONS } from "@/config/firebase";
import { ValidationError, ConflictError, PlanLimitError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

// ─── Service ─────────────────────────────────────────────────────────────────

export class OrganizationService extends BaseService {
  async create(dto: CreateOrganizationDto, user: AuthUser): Promise<Organization> {
    this.requirePermission(user, "organization:create");

    // Check if slug is taken
    const existing = await organizationRepository.findBySlug(dto.slug);
    if (existing) {
      throw new ConflictError(`Organization slug '${dto.slug}' is already taken`);
    }

    // One org per user (unless super_admin)
    if (!user.roles.includes("super_admin")) {
      const existingOwned = await organizationRepository.findByOwner(user.uid);
      if (existingOwned) {
        throw new ConflictError("Vous possédez déjà une organisation");
      }
    }

    const org = await organizationRepository.create({
      ...dto,
      ownerId: user.uid,
      memberIds: [user.uid],
      isVerified: false,
      isActive: true,
    } as Omit<Organization, "id" | "createdAt" | "updatedAt">);

    const newRoles = [...new Set([...user.roles, "organizer"])];

    // Mirror organizationId + roles onto the user's Firestore doc BEFORE
    // updating Auth custom claims. Firestore security rules read
    // `resource.data.organizationId` from the user doc (firestore.rules),
    // so the doc must carry the new value at the moment the client starts
    // using the updated claims — otherwise rules deny reads the user's
    // claims already permit. Without this mirror, rules that rely on the
    // user doc's organizationId are de-facto dead for every org creator.
    //
    // Use set(..., { merge: true }) rather than update() so the path
    // survives a race where the requesting user's Firestore doc hasn't
    // been written yet by the onUserCreated trigger (rare but real:
    // observable on fresh staging deploys and in integration tests).
    await db.collection(COLLECTIONS.USERS).doc(user.uid).set(
      {
        roles: newRoles,
        organizationId: org.id,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    // Then update Firebase Auth custom claims (JWT source of truth for
    // middleware authorization on the API side).
    //
    // Rolling back `create` on claims failure is structurally hard: the
    // `organizations/{id}` doc is already committed and deleting it
    // races with any downstream listener. Instead we LOG the drift to
    // stderr for alerting AND re-throw the Auth error. The MEDIUM-3
    // drift-detection pill in /admin/users will surface the user
    // visually, and the operator can re-invoke the mutation (which is
    // idempotent: both the doc-mirror set(merge) and setCustomUserClaims
    // produce the same end-state on retry).
    try {
      await auth.setCustomUserClaims(user.uid, {
        roles: newRoles,
        organizationId: org.id,
      });
    } catch (err) {
      process.stderr.write(
        `organization.create: setCustomUserClaims FAILED for uid=${user.uid} orgId=${org.id} — Firestore doc mirrored, JWT drift until retry. Error: ${String(err)}\n`,
      );
      throw err;
    }

    eventBus.emit("organization.created", {
      organization: org,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return org;
  }

  async getById(orgId: string, user: AuthUser): Promise<Organization> {
    this.requirePermission(user, "organization:read");
    return organizationRepository.findByIdOrThrow(orgId);
  }

  async getBySlug(slug: string): Promise<Organization> {
    const org = await organizationRepository.findBySlug(slug);
    if (!org) {
      const { NotFoundError } = await import("@/errors/app-error");
      throw new NotFoundError("Organization", slug);
    }
    return org;
  }

  async update(orgId: string, dto: UpdateOrganizationDto, user: AuthUser): Promise<void> {
    this.requirePermission(user, "organization:update");

    const org = await organizationRepository.findByIdOrThrow(orgId);
    this.requireOrganizationAccess(user, org.id);

    await organizationRepository.update(orgId, dto as Partial<Organization>);

    eventBus.emit("organization.updated", {
      organizationId: orgId,
      changes: dto as Record<string, unknown>,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  async addMember(orgId: string, userId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "organization:manage_members");
    this.requireOrganizationAccess(user, orgId);

    await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Organization", orgId);
      }
      const org = { id: snap.id, ...snap.data() } as Organization;
      const members: string[] = org.memberIds ?? [];

      if (members.includes(userId)) return;

      const { allowed, limit } = this.checkPlanLimit(org, "members", members.length);
      if (!allowed) {
        throw new PlanLimitError(
          `Maximum ${limit} members on the ${org.effectivePlanKey ?? org.plan} plan`,
        );
      }

      tx.update(docRef, { memberIds: [...members, userId] });
      // Mirror organizationId onto the new member's Firestore user doc
      // in the SAME transaction so the org membership and the user's
      // scope tag commit atomically. See the `create()` comment for why
      // Firestore rules depend on this mirror.
      //
      // tx.set(..., { merge: true }) rather than tx.update() — the added
      // member may not yet have a Firestore user doc (Auth trigger race,
      // or admin-added user who never logged in).
      tx.set(
        db.collection(COLLECTIONS.USERS).doc(userId),
        {
          organizationId: orgId,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    });

    eventBus.emit("member.added", {
      organizationId: orgId,
      memberId: userId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    // Update Firebase Auth custom claims AFTER the Firestore writes
    // committed. If the Auth call fails transiently we compensate by
    // reverting the membership AND clearing the mirror we just wrote
    // so the two stores stay aligned. Without the rollback the user
    // would show up as a member (Firestore + doc mirror) while the
    // JWT refuses all org-scoped endpoints — same Class C drift PR #65
    // fixed for admin.service. We do a single-tx rollback because both
    // the org doc and the user mirror are involved.
    const existingUser = await auth.getUser(userId);
    const existingClaims = existingUser.customClaims ?? {};
    try {
      await auth.setCustomUserClaims(userId, {
        ...existingClaims,
        organizationId: orgId,
      });
    } catch (err) {
      try {
        await db.runTransaction(async (tx) => {
          const docRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId);
          const snap = await tx.get(docRef);
          if (snap.exists) {
            const current = snap.data() as Organization;
            const next = (current.memberIds ?? []).filter((m) => m !== userId);
            tx.update(docRef, { memberIds: next });
          }
          tx.set(
            db.collection(COLLECTIONS.USERS).doc(userId),
            {
              organizationId: (existingClaims.organizationId as string | null | undefined) ?? null,
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
        });
      } catch (rollbackErr) {
        process.stderr.write(
          `organization.addMember: rollback FAILED for orgId=${orgId} userId=${userId} after setCustomUserClaims error: ${String(rollbackErr)}\n`,
        );
      }
      throw err;
    }
  }

  async removeMember(orgId: string, userId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "organization:manage_members");

    const org = await organizationRepository.findByIdOrThrow(orgId);
    this.requireOrganizationAccess(user, org.id);

    // Cannot remove the owner
    if (userId === org.ownerId) {
      throw new ValidationError("Impossible de retirer le propriétaire de l'organisation");
    }

    await organizationRepository.removeMember(orgId, userId);

    // Clear organizationId on the user's Firestore doc in sync with the
    // org membership removal. Without this, the Firestore rule keeps
    // treating the user as a member of the (now-left) org for subsequent
    // reads — drift between the doc and the claims.
    //
    // set(..., { merge: true }) handles the rare case where the removed
    // user has no Firestore doc (admin-added + never logged in).
    await db.collection(COLLECTIONS.USERS).doc(userId).set(
      {
        organizationId: null,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    eventBus.emit("member.removed", {
      organizationId: orgId,
      memberId: userId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    // Clear organizationId from user's custom claims. Same rollback
    // policy as addMember: if the Auth call fails, re-add the user to
    // memberIds + restore the doc mirror so Firestore and claims stay
    // aligned. Without it the user would show as removed in Firestore
    // while the JWT still carries the old organizationId — granted
    // access they shouldn't have until the next token refresh.
    const existingUser = await auth.getUser(userId);
    const existingClaims = existingUser.customClaims ?? {};
    try {
      await auth.setCustomUserClaims(userId, {
        ...existingClaims,
        organizationId: null,
      });
    } catch (err) {
      try {
        // Restore membership + mirror
        await organizationRepository.addMember(orgId, userId);
        await db.collection(COLLECTIONS.USERS).doc(userId).set(
          {
            organizationId: orgId,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      } catch (rollbackErr) {
        process.stderr.write(
          `organization.removeMember: rollback FAILED for orgId=${orgId} userId=${userId} after setCustomUserClaims error: ${String(rollbackErr)}\n`,
        );
      }
      throw err;
    }
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    role: OrgMemberRole,
    user: AuthUser,
  ): Promise<void> {
    this.requirePermission(user, "organization:manage_members");

    const org = await organizationRepository.findByIdOrThrow(orgId);
    this.requireOrganizationAccess(user, org.id);

    // Cannot change the owner's role
    if (userId === org.ownerId) {
      throw new ValidationError("Impossible de modifier le rôle du propriétaire");
    }

    // Verify user is a member
    if (!org.memberIds?.includes(userId)) {
      throw new ValidationError("Cet utilisateur n'est pas membre de l'organisation");
    }

    // Role "owner" cannot be assigned via this endpoint
    if (role === "owner") {
      throw new ValidationError("Le rôle propriétaire ne peut pas être attribué de cette manière");
    }

    // Capture the previous orgRole BEFORE any write — both from the
    // Firestore doc (current visible state) and from the Auth claims
    // (current enforced state). On Auth failure we use the doc's
    // previous value for compensation; if the doc was never mirrored
    // before (field absent), we fall back to null.
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const previousOrgRole = (userDoc.data()?.orgRole as string | null | undefined) ?? null;

    // Mirror orgRole onto the user's Firestore doc BEFORE updating Auth
    // claims. Same Class B drift fix as create/addMember/removeMember:
    // anything that reads the user doc (Firestore rules, admin UI list,
    // member-management screens) sees the new role immediately. Without
    // this mirror the role lived only in claims and the UI showed the
    // pre-change role until the user re-logged in. set(..., {merge:true})
    // for the same reason as the other mirrors — invitee may not have a
    // Firestore doc yet.
    await db.collection(COLLECTIONS.USERS).doc(userId).set(
      {
        orgRole: role,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    // Update role in custom claims AFTER the doc mirror committed.
    // Same rollback-on-Auth-failure pattern as addMember / removeMember:
    // restore the previous orgRole on the user doc if the claim call
    // fails, so the two stores stay aligned rather than drifting.
    const existingUser = await auth.getUser(userId);
    const existingClaims = existingUser.customClaims ?? {};
    try {
      await auth.setCustomUserClaims(userId, {
        ...existingClaims,
        orgRole: role,
      });
    } catch (err) {
      try {
        await db.collection(COLLECTIONS.USERS).doc(userId).set(
          {
            orgRole: previousOrgRole,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      } catch (rollbackErr) {
        process.stderr.write(
          `organization.updateMemberRole: rollback FAILED for orgId=${orgId} userId=${userId} after setCustomUserClaims error: ${String(rollbackErr)}\n`,
        );
      }
      throw err;
    }

    eventBus.emit("member.role_updated", {
      organizationId: orgId,
      memberId: userId,
      newRole: role,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }
}

export const organizationService = new OrganizationService();
