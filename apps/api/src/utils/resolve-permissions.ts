import { type Permission, type RoleAssignment, resolvePermissions } from "@teranga/shared-types";
import { type AuthUser } from "@/middlewares/auth.middleware";

/**
 * Resolve effective permissions from a user's JWT roles.
 *
 * Shared between permission middleware (HTTP layer) and BaseService
 * (business logic layer) to eliminate duplicate implementations that
 * could drift independently.
 */
export function resolveUserPermissions(user: AuthUser): Set<Permission> {
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
