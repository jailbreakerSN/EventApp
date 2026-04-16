import { BaseService } from "./base.service";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { adminRepository } from "@/repositories/admin.repository";
import { db, auth, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { NotFoundError, ForbiddenError } from "@/errors/app-error";
import type {
  PlatformStats,
  PlanAnalytics,
  AdminUserQuery,
  AdminOrgQuery,
  AdminEventQuery,
  AdminAuditQuery,
  AdminUserRow,
  ClaimsMatch,
  UserProfile,
  Organization,
  Event,
  AuditLogEntry,
  Plan,
  Subscription,
} from "@teranga/shared-types";
import type { PaginatedResult } from "@/repositories/base.repository";
import { eventRepository } from "@/repositories/event.repository";
import { computePlanAnalytics } from "./plan-analytics";

// ─── Admin Service ──────────────────────────────────────────────────────────
// Platform-wide administration. Every method requires platform:manage permission.

/**
 * Grace window during which a fresh user (Firestore doc newly created)
 * can have empty/undefined Auth custom claims without triggering a
 * drift warning. Chosen so the onUserCreated trigger has enough time
 * to run and write the initial claim set — 5 minutes is generous for
 * both local emulators and Cloud Functions cold-starts in prod.
 */
const CLAIMS_PROPAGATION_GRACE_MS = 5 * 60 * 1000;

/**
 * Set-equality for role arrays — the ordering differs between Firestore
 * (insertion order) and Auth custom claims (server-assigned), but the
 * semantic set is what matters for drift detection.
 */
function arraysEqualAsSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  for (const item of b) if (!aSet.has(item)) return false;
  return true;
}

class AdminService extends BaseService {
  // ── Platform Stats ────────────────────────────────────────────────────

  async getStats(user: AuthUser): Promise<PlatformStats> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.getPlatformStats();
  }

  // ── User Management ───────────────────────────────────────────────────

  async listUsers(user: AuthUser, query: AdminUserQuery): Promise<PaginatedResult<AdminUserRow>> {
    this.requirePermission(user, "platform:manage");
    const page = await adminRepository.listAllUsers(
      { q: query.q, role: query.role, isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );

    // Enrich each row with a JWT ↔ Firestore drift check. Admin UI
    // displays a visible warning on rows where the two disagree so
    // operators don't apply mutations against stale state (see the
    // `AdminUserRow` type comment in shared-types). Bounded cardinality
    // — admin table pages at 20 rows — so N+1 `auth.getUser` is
    // acceptable. Batching via `auth.getUsers([...])` would be cleaner
    // but firebase-admin's batch identifier interface is clunky for
    // our pagination pattern; defer until this becomes a latency issue.
    const enriched = await Promise.all(
      page.data.map(async (u): Promise<AdminUserRow> => this.attachClaimsMatch(u)),
    );

    return { ...page, data: enriched };
  }

  /**
   * Compare a Firestore user doc's roles / organizationId / orgRole against
   * the Firebase Auth custom claims for the same uid. Returns the row
   * shape the admin UI consumes, with `claimsMatch: null` when the Auth
   * record can't be fetched (user deleted in Auth but doc lingers, or
   * transient Admin SDK failure — both worth surfacing visually).
   */
  private async attachClaimsMatch(profile: UserProfile): Promise<AdminUserRow> {
    const base: Omit<AdminUserRow, "claimsMatch"> = {
      uid: profile.uid,
      email: profile.email,
      displayName: profile.displayName,
      photoURL: profile.photoURL ?? null,
      phone: profile.phone ?? null,
      bio: profile.bio ?? null,
      roles: profile.roles,
      organizationId: profile.organizationId ?? null,
      orgRole: profile.orgRole ?? null,
      preferredLanguage: profile.preferredLanguage,
      isEmailVerified: profile.isEmailVerified,
      isActive: profile.isActive,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };

    try {
      const record = await auth.getUser(profile.uid);
      const rawClaims = record.customClaims;
      const claims = (rawClaims ?? {}) as Record<string, unknown>;

      // Fresh-user grace window: if Auth has NO custom claims set yet
      // (undefined or empty object) AND the Firestore doc was created
      // less than CLAIMS_PROPAGATION_GRACE_MS ago, treat the two as in
      // sync. Rationale: the onUserCreated Cloud Function trigger sets
      // the initial claims asynchronously, so a brand-new account that
      // hasn't had its first claim-write yet will otherwise light up
      // a false-positive drift pill every single time. We don't want
      // operators to develop habituation to a warning they should
      // actually act on.
      const claimsAreEmpty = rawClaims == null || Object.keys(claims).length === 0;
      const createdAtMs = new Date(profile.createdAt).getTime();
      const withinGraceWindow =
        Number.isFinite(createdAtMs) && Date.now() - createdAtMs < CLAIMS_PROPAGATION_GRACE_MS;
      if (claimsAreEmpty && withinGraceWindow) {
        return {
          ...base,
          claimsMatch: { roles: true, organizationId: true, orgRole: true },
        };
      }

      const claimRoles = (claims.roles as string[] | undefined) ?? [];
      const claimOrgId = (claims.organizationId as string | null | undefined) ?? null;
      const claimOrgRole = (claims.orgRole as string | null | undefined) ?? null;

      const match: ClaimsMatch = {
        roles: arraysEqualAsSet(profile.roles, claimRoles),
        organizationId: (profile.organizationId ?? null) === claimOrgId,
        orgRole: (profile.orgRole ?? null) === claimOrgRole,
      };
      return { ...base, claimsMatch: match };
    } catch {
      // Auth fetch failed — surface visually via claimsMatch: null
      // rather than hiding the row or throwing. The admin can still
      // operate on the row and will see the warning badge.
      return { ...base, claimsMatch: null };
    }
  }

  async updateUserRoles(user: AuthUser, targetUserId: string, roles: string[]): Promise<void> {
    this.requirePermission(user, "platform:manage");

    // Prevent self-demotion from super_admin
    if (targetUserId === user.uid && !roles.includes("super_admin")) {
      throw new ForbiddenError("Impossible de retirer votre propre rôle super_admin");
    }

    // Fetch current user doc
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(targetUserId).get();
    if (!userDoc.exists) throw new NotFoundError("User", targetUserId);

    const currentData = userDoc.data()!;
    const oldRoles = (currentData.roles as string[]) ?? ["participant"];

    // Update Firestore user doc FIRST.
    await db.collection(COLLECTIONS.USERS).doc(targetUserId).update({
      roles,
      updatedAt: new Date().toISOString(),
    });

    // Update Firebase Auth custom claims (critical — JWT is source of
    // truth for middleware). If this fails (transient Auth API outage,
    // Cloud Run cold-start to Auth, IAM revoke mid-request, etc.) we
    // roll back the Firestore write so the two stores stay aligned.
    // Without the rollback we'd recreate the exact symptom PR #59 fixed
    // for the onUserCreated trigger — admin UI shows new roles, JWT
    // still carries old ones, every endpoint denies the user, and the
    // operator has no signal that anything went wrong.
    try {
      await auth.setCustomUserClaims(targetUserId, {
        roles,
        organizationId: currentData.organizationId ?? undefined,
      });
    } catch (err) {
      // Compensating write — best-effort, but the original Auth error
      // is what the operator needs to see, so we surface that.
      try {
        await db.collection(COLLECTIONS.USERS).doc(targetUserId).update({
          roles: oldRoles,
          updatedAt: new Date().toISOString(),
        });
      } catch (rollbackErr) {
        // The compensating write itself failed — log + continue. The
        // user doc is now in the new state but the claims are stale.
        // Surface the original Auth error so the operator retries.
        process.stderr.write(
          `admin.updateUserRoles: rollback FAILED for user ${targetUserId} after setCustomUserClaims error: ${String(rollbackErr)}\n`,
        );
      }
      throw err;
    }

    eventBus.emit("user.role_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      targetUserId,
      oldRoles,
      newRoles: roles,
    });
  }

  async updateUserStatus(user: AuthUser, targetUserId: string, isActive: boolean): Promise<void> {
    this.requirePermission(user, "platform:manage");

    // Prevent self-suspension
    if (targetUserId === user.uid) {
      throw new ForbiddenError("Impossible de suspendre votre propre compte");
    }

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(targetUserId).get();
    if (!userDoc.exists) throw new NotFoundError("User", targetUserId);

    const previousIsActive = (userDoc.data()?.isActive as boolean | undefined) ?? true;

    // Update Firestore
    await db.collection(COLLECTIONS.USERS).doc(targetUserId).update({
      isActive,
      updatedAt: new Date().toISOString(),
    });

    // Disable/enable in Firebase Auth. Same drift-rollback story as
    // updateUserRoles: a transient Auth failure here would leave the
    // user marked inactive in Firestore (admin UI shows suspended) but
    // still able to log in (Auth doesn't know they're disabled).
    try {
      await auth.updateUser(targetUserId, { disabled: !isActive });
    } catch (err) {
      try {
        await db.collection(COLLECTIONS.USERS).doc(targetUserId).update({
          isActive: previousIsActive,
          updatedAt: new Date().toISOString(),
        });
      } catch (rollbackErr) {
        process.stderr.write(
          `admin.updateUserStatus: rollback FAILED for user ${targetUserId} after auth.updateUser error: ${String(rollbackErr)}\n`,
        );
      }
      throw err;
    }

    eventBus.emit("user.status_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      targetUserId,
      isActive,
    });
  }

  // ── Organization Management ───────────────────────────────────────────

  async listOrganizations(
    user: AuthUser,
    query: AdminOrgQuery,
  ): Promise<PaginatedResult<Organization>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAllOrganizations(
      { q: query.q, plan: query.plan, isVerified: query.isVerified, isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );
  }

  async verifyOrganization(user: AuthUser, orgId: string): Promise<void> {
    this.requirePermission(user, "platform:manage");

    const orgDoc = await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).get();
    if (!orgDoc.exists) throw new NotFoundError("Organization", orgId);

    await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).update({
      isVerified: true,
      updatedAt: new Date().toISOString(),
    });

    eventBus.emit("organization.verified", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      organizationId: orgId,
    });
  }

  async updateOrgStatus(user: AuthUser, orgId: string, isActive: boolean): Promise<void> {
    this.requirePermission(user, "platform:manage");

    const orgDoc = await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).get();
    if (!orgDoc.exists) throw new NotFoundError("Organization", orgId);

    await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).update({
      isActive,
      updatedAt: new Date().toISOString(),
    });

    eventBus.emit("organization.status_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      organizationId: orgId,
      isActive,
    });
  }

  // ── Event Oversight ───────────────────────────────────────────────────

  async listEvents(user: AuthUser, query: AdminEventQuery): Promise<PaginatedResult<Event>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAllEvents(
      { q: query.q, status: query.status, organizationId: query.organizationId },
      { page: query.page, limit: query.limit },
    );
  }

  // ── Audit Logs ────────────────────────────────────────────────────────

  async listAuditLogs(
    user: AuthUser,
    query: AdminAuditQuery,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAuditLogs(
      {
        action: query.action,
        actorId: query.actorId,
        resourceType: query.resourceType,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      { page: query.page, limit: query.limit, orderBy: "timestamp", orderDir: "desc" },
    );
  }

  // ── Plan Analytics (Phase 7+ item #5) ──────────────────────────────────
  //
  // Point-in-time aggregate for the superadmin dashboard. Runs one batched
  // fetch over the three collections we need (subscriptions, organizations,
  // plans) plus per-org event counts, folds them into a `PlanAnalytics`
  // shape in memory, and returns it. No server-side caching — the
  // numbers are small and operators want fresh data on refresh.
  //
  // The shape is described in detail by the `PlanAnalytics` type in
  // shared-types. The pure fold lives in `./plan-analytics.ts` so it's
  // unit-testable without the emulator.
  async getPlanAnalytics(user: AuthUser): Promise<PlanAnalytics> {
    this.requirePermission(user, "platform:manage");

    // Fetch subs, orgs, plans in parallel. Each list is bounded by a
    // generous `limit: 1000` — superadmins view this on fleets below that
    // scale in practice; when we outgrow it, a BigQuery export pipeline
    // is the right answer rather than paginated Firestore scans.
    const [subsSnap, orgsSnap, plansSnap] = await Promise.all([
      db.collection(COLLECTIONS.SUBSCRIPTIONS).limit(1000).get(),
      db.collection(COLLECTIONS.ORGANIZATIONS).limit(1000).get(),
      db.collection(COLLECTIONS.PLANS).get(),
    ]);

    const subscriptions = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Subscription);
    const organizations = orgsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Organization);
    const plans = plansSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Plan);

    // Parallel per-org event counts for the near-limit calculation. We
    // use the existing repository helper so the count stays consistent
    // with the runtime enforcement path (same `status IN` filter).
    const activeEventsByOrgId = new Map<string, number>();
    await Promise.all(
      organizations.map(async (org) => {
        const count = await eventRepository.countActiveByOrganization(org.id);
        activeEventsByOrgId.set(org.id, count);
      }),
    );

    return computePlanAnalytics({
      subscriptions,
      organizations,
      plans,
      activeEventsByOrgId,
      now: new Date(),
    });
  }
}

export const adminService = new AdminService();
