import {
  type Permission,
  type OrganizationPlan,
  type PlanFeature,
  PLAN_LIMITS,
  hasPermission,
} from "@teranga/shared-types";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ForbiddenError, PlanLimitError } from "@/errors/app-error";
import { resolveUserPermissions } from "@/utils/resolve-permissions";

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
   * Throw PlanLimitError if the plan does not include the given feature.
   */
  protected requirePlanFeature(plan: OrganizationPlan, feature: PlanFeature): void {
    const limits = PLAN_LIMITS[plan];
    if (!limits.features[feature]) {
      throw new PlanLimitError(
        `La fonctionnalité « ${feature} » n'est pas disponible sur le plan ${plan}`,
        { feature, plan },
      );
    }
  }

  /**
   * Check a numeric plan limit without throwing.
   * Returns the comparison so the caller can decide (throw, waitlist, etc.).
   */
  protected checkPlanLimit(
    plan: OrganizationPlan,
    resource: "events" | "members" | "participantsPerEvent",
    current: number,
  ): { allowed: boolean; current: number; limit: number } {
    const limits = PLAN_LIMITS[plan];
    const limit =
      resource === "events"
        ? limits.maxEvents
        : resource === "members"
          ? limits.maxMembers
          : limits.maxParticipantsPerEvent;

    return {
      allowed: !isFinite(limit) || current < limit,
      current,
      limit,
    };
  }

  /**
   * Resolve effective permissions from the user's roles and organization context.
   * Delegates to the shared utility in `utils/resolve-permissions.ts`.
   */
  protected resolveUserPermissions(user: AuthUser): Set<Permission> {
    return resolveUserPermissions(user);
  }
}
