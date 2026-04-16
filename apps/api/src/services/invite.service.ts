import crypto from "node:crypto";
import {
  type CreateInviteDto,
  type OrganizationInvite,
  type Organization,
} from "@teranga/shared-types";
import { inviteRepository } from "@/repositories/invite.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { userRepository } from "@/repositories/user.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { auth, db, COLLECTIONS } from "@/config/firebase";
import { ConflictError, NotFoundError, ValidationError, PlanLimitError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

export class InviteService extends BaseService {
  /**
   * Create an invitation for someone to join the organization.
   */
  async createInvite(
    orgId: string,
    dto: CreateInviteDto,
    user: AuthUser,
  ): Promise<OrganizationInvite> {
    this.requirePermission(user, "organization:manage_members");
    this.requireOrganizationAccess(user, orgId);

    const org = await organizationRepository.findByIdOrThrow(orgId);

    // Check plan limits (reads org.effectiveLimits via BaseService with safe
    // fallback to PLAN_LIMITS[org.plan] when denormalization is missing)
    const currentMembers = org.memberIds?.length ?? 0;
    const pendingInvites = await inviteRepository.findByOrganization(orgId);
    const pendingCount = pendingInvites.filter((i) => i.status === "pending").length;

    const { allowed, limit } = this.checkPlanLimit(org, "members", currentMembers + pendingCount);
    if (!allowed) {
      throw new PlanLimitError(
        `Maximum ${limit} membres (invitations en attente incluses) sur le plan ${org.effectivePlanKey ?? org.plan}`,
      );
    }

    // Check if already a member
    const existingUser = await userRepository.findByEmail(dto.email);
    if (existingUser && org.memberIds?.includes(existingUser.uid)) {
      throw new ConflictError("Cet utilisateur est déjà membre de l'organisation");
    }

    // Check if there's already a pending invite
    const existingInvite = await inviteRepository.findByEmailAndOrg(dto.email, orgId);
    if (existingInvite) {
      throw new ConflictError("Une invitation en attente existe déjà pour cet email");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    const invite = await inviteRepository.createWithId(
      `inv-${crypto.randomBytes(8).toString("hex")}`,
      {
        organizationId: orgId,
        organizationName: org.name,
        email: dto.email,
        role: dto.role ?? "member",
        status: "pending",
        invitedBy: user.uid,
        invitedByName: user.email ?? null,
        token,
        expiresAt,
      } as Omit<OrganizationInvite, "id" | "createdAt" | "updatedAt">,
    );

    eventBus.emit("invite.created", {
      inviteId: invite.id,
      organizationId: orgId,
      email: dto.email,
      role: dto.role ?? "member",
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return invite;
  }

  /**
   * List all invitations for an organization.
   */
  async listByOrganization(orgId: string, user: AuthUser): Promise<OrganizationInvite[]> {
    this.requirePermission(user, "organization:read");
    this.requireOrganizationAccess(user, orgId);
    return inviteRepository.findByOrganization(orgId);
  }

  /**
   * Accept an invitation using the token. The current user joins the organization.
   */
  async acceptInvite(token: string, user: AuthUser): Promise<void> {
    const invite = await inviteRepository.findByToken(token);
    if (!invite) throw new NotFoundError("Invite");
    if (invite.status !== "pending") {
      throw new ValidationError(`Cette invitation a déjà été traitée (${invite.status})`);
    }
    if (new Date(invite.expiresAt) < new Date()) {
      await inviteRepository.update(invite.id, {
        status: "expired",
      } as Partial<OrganizationInvite>);
      throw new ValidationError("Cette invitation a expiré");
    }

    // Verify the accepting user's email matches
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ValidationError("Cette invitation a été envoyée à une autre adresse email");
    }

    // Add user to organization (transactional)
    await db.runTransaction(async (tx) => {
      const orgRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(invite.organizationId);
      const snap = await tx.get(orgRef);
      if (!snap.exists) throw new NotFoundError("Organization", invite.organizationId);

      const org = { id: snap.id, ...snap.data() } as Organization;
      const members: string[] = org.memberIds ?? [];

      if (members.includes(user.uid)) {
        // Already a member — just mark invite as accepted
        tx.update(db.collection(COLLECTIONS.INVITES).doc(invite.id), {
          status: "accepted",
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      const { allowed, limit } = this.checkPlanLimit(org, "members", members.length);
      if (!allowed) {
        throw new PlanLimitError(`Organization has reached the maximum of ${limit} members`);
      }

      tx.update(orgRef, {
        memberIds: [...members, user.uid],
        updatedAt: new Date().toISOString(),
      });
      tx.update(db.collection(COLLECTIONS.INVITES).doc(invite.id), {
        status: "accepted",
        updatedAt: new Date().toISOString(),
      });
      // Mirror organizationId onto the accepting user's Firestore doc
      // in the SAME transaction. Firestore rules read organizationId
      // from the user doc (not claims), so without this mirror the
      // invitee is granted access by their new custom claims but rules
      // still see them as unaffiliated — read-denials despite the
      // invite being accepted.
      tx.update(db.collection(COLLECTIONS.USERS).doc(user.uid), {
        organizationId: invite.organizationId,
        updatedAt: new Date().toISOString(),
      });
    });

    // Set custom claims for the new member AFTER the Firestore
    // mirror committed. Rule checks only need the doc; claims are
    // for the API middleware's JWT decoding.
    const existingClaims = (await auth.getUser(user.uid)).customClaims ?? {};
    await auth.setCustomUserClaims(user.uid, {
      ...existingClaims,
      organizationId: invite.organizationId,
    });

    eventBus.emit("invite.accepted", {
      inviteId: invite.id,
      organizationId: invite.organizationId,
      userId: user.uid,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Decline an invitation.
   */
  async declineInvite(token: string, user: AuthUser): Promise<void> {
    const invite = await inviteRepository.findByToken(token);
    if (!invite) throw new NotFoundError("Invite");
    if (invite.status !== "pending") {
      throw new ValidationError(`Cette invitation a déjà été traitée (${invite.status})`);
    }
    if (new Date(invite.expiresAt) < new Date()) {
      await inviteRepository.update(invite.id, {
        status: "expired",
      } as Partial<OrganizationInvite>);
      throw new ValidationError("Cette invitation a expiré");
    }
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ValidationError("Cette invitation a été envoyée à une autre adresse email");
    }

    await inviteRepository.update(invite.id, { status: "declined" } as Partial<OrganizationInvite>);

    eventBus.emit("invite.declined", {
      inviteId: invite.id,
      organizationId: invite.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Revoke a pending invitation (by an org admin).
   */
  async revokeInvite(inviteId: string, user: AuthUser): Promise<void> {
    const invite = await inviteRepository.findByIdOrThrow(inviteId);
    this.requirePermission(user, "organization:manage_members");
    this.requireOrganizationAccess(user, invite.organizationId);

    if (invite.status !== "pending") {
      throw new ValidationError("Seules les invitations en attente peuvent être révoquées");
    }

    await inviteRepository.update(inviteId, { status: "expired" } as Partial<OrganizationInvite>);

    eventBus.emit("invite.revoked", {
      inviteId,
      organizationId: invite.organizationId,
      email: invite.email,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }
}

export const inviteService = new InviteService();
