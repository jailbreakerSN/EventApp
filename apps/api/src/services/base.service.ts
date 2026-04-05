import {
  type Permission,
  type RoleAssignment,
  hasPermission,
  resolvePermissions,
} from "@teranga/shared-types";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ForbiddenError } from "@/errors/app-error";

/**
 * Base service providing shared permission resolution logic.
 * All domain services extend this to get consistent access control.
 */
export abstract class BaseService {
  /**
   * Throw ForbiddenError if the user lacks the given permission.
   */
  protected requirePermission(user: AuthUser, permission: Permission): void {
    const perms = this.resolveUserPermissions(user);
    if (!hasPermission(perms, permission)) {
      throw new ForbiddenError(`Missing permission: ${permission}`);
    }
  }

  /**
   * Throw ForbiddenError if the user doesn't belong to the organization.
   * super_admin bypasses this check.
   */
  protected requireOrganizationAccess(user: AuthUser, organizationId: string): void {
    if (user.roles.includes("super_admin")) return;
    if (user.organizationId !== organizationId) {
      throw new ForbiddenError("Access denied to this organization's resources");
    }
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
