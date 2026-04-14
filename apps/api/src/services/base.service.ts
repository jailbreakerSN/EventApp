import {
  type Organization,
  type Permission,
  type PlanFeature,
  type PlanFeatures,
  type RoleAssignment,
  PLAN_LIMITS,
  PLAN_LIMIT_UNLIMITED,
  hasPermission,
  resolvePermissions,
} from "@teranga/shared-types";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ForbiddenError, PlanLimitError } from "@/errors/app-error";

// ─── Effective-plan fallback helpers ─────────────────────────────────────────
//
// Phase 3 of dynamic plans: enforcement reads `org.effectiveLimits` /
// `org.effectiveFeatures` first. If these are missing (an org that predates
// the Phase 2 backfill, or an org created mid-deploy before the plan doc was
// seeded), we fall back to the hardcoded `PLAN_LIMITS` record keyed by the
// legacy `org.plan` enum. This keeps every request safe while we finish the
// rollout; Phase 6 removes the hardcoded constants once no org is missing
// effective fields.

function storedToRuntime(n: number): number {
  return n === PLAN_LIMIT_UNLIMITED ? Infinity : n;
}

function effectiveFeatures(org: Organization): PlanFeatures {
  if (org.effectiveFeatures) return org.effectiveFeatures;
  return PLAN_LIMITS[org.plan].features;
}

type LimitResource = "events" | "members" | "participantsPerEvent";

function effectiveLimit(org: Organization, resource: LimitResource): number {
  if (org.effectiveLimits) {
    const stored =
      resource === "events"
        ? org.effectiveLimits.maxEvents
        : resource === "members"
          ? org.effectiveLimits.maxMembers
          : org.effectiveLimits.maxParticipantsPerEvent;
    return storedToRuntime(stored);
  }
  // Fallback: read from the hardcoded PLAN_LIMITS table.
  const legacy = PLAN_LIMITS[org.plan];
  return resource === "events"
    ? legacy.maxEvents
    : resource === "members"
      ? legacy.maxMembers
      : legacy.maxParticipantsPerEvent;
}

/**
 * Base service providing shared permission resolution logic.
 * All domain services extend this to get consistent access control.
 */
export abstract class BaseService {
  /**
   * Throw ForbiddenError if the user lacks the given permission.
   */
  protected requirePermission(user: AuthUser, permission: Permission): void {
    if (!this.hasPermission(user, permission)) {
      throw new ForbiddenError(`Permission manquante : ${permission}`);
    }
  }

  /**
   * Check if user has a permission without throwing.
   * Useful for conditional logic (e.g., auto-approve for admins).
   */
  protected hasPermission(user: AuthUser, permission: Permission): boolean {
    const perms = this.resolveUserPermissions(user);
    return hasPermission(perms, permission);
  }

  /**
   * Throw ForbiddenError if the user doesn't belong to the organization.
   * super_admin bypasses this check.
   */
  protected requireOrganizationAccess(user: AuthUser, organizationId: string): void {
    if (user.roles.includes("super_admin")) return;
    if (user.organizationId !== organizationId) {
      throw new ForbiddenError("Accès refusé aux ressources de cette organisation");
    }
  }

  /**
   * Throw PlanLimitError if the organization's effective plan does not include
   * the given feature. Reads `org.effectiveFeatures` with a safe fallback to
   * the hardcoded `PLAN_LIMITS[org.plan].features` record when the
   * denormalization is missing (e.g. pre-backfill org).
   */
  protected requirePlanFeature(org: Organization, feature: PlanFeature): void {
    const features = effectiveFeatures(org);
    if (!features[feature]) {
      throw new PlanLimitError(
        `La fonctionnalité « ${feature} » n'est pas disponible sur le plan ${org.effectivePlanKey ?? org.plan}`,
        { feature, plan: org.effectivePlanKey ?? org.plan },
      );
    }
  }

  /**
   * Check a numeric plan limit without throwing.
   * Returns the comparison so the caller can decide (throw, waitlist, etc.).
   *
   * Reads `org.effectiveLimits` with a safe fallback to `PLAN_LIMITS[org.plan]`
   * when the denormalization is missing.
   */
  protected checkPlanLimit(
    org: Organization,
    resource: LimitResource,
    current: number,
  ): { allowed: boolean; current: number; limit: number } {
    const limit = effectiveLimit(org, resource);
    return {
      allowed: !isFinite(limit) || current < limit,
      current,
      limit,
    };
  }

  /**
   * Resolve effective permissions from the user's roles and organization context.
   *
   * Currently builds inline RoleAssignments from the JWT custom claims.
   * When the full RoleAssignment Firestore collection is implemented,
   * this method can be updated to fetch real assignments — all services
   * benefit automatically.
   */
  protected resolveUserPermissions(user: AuthUser): Set<Permission> {
    const assignments: RoleAssignment[] = user.roles.map((role) => ({
      id: `inline-${role}`,
      userId: user.uid,
      role,
      scope: user.organizationId ? ("organization" as const) : ("global" as const),
      organizationId: user.organizationId ?? null,
      eventId: null,
      grantedBy: "system",
      grantedAt: new Date().toISOString(),
      isActive: true,
    }));

    return resolvePermissions(assignments, {
      organizationId: user.organizationId,
    });
  }
}
