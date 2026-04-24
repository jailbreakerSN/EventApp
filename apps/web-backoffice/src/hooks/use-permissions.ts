"use client";

/**
 * Client-side permission resolution.
 *
 * The canonical logic lives in `@teranga/shared-types` (`resolvePermissions`
 * + `hasPermission`), but that API takes the richer `RoleAssignment[]`
 * shape (scope, orgId, eventId) which the client does not have. The
 * client only has the `roles: UserRole[]` claim from the current ID
 * token. For UI gating that mirrors server-side checks we derive the
 * effective permission set from `DEFAULT_ROLE_PERMISSIONS` union'd
 * across the user's active roles.
 *
 * Why mirror, not request a dedicated endpoint? Two reasons:
 *   1. `DEFAULT_ROLE_PERMISSIONS` is static data — shipping a network
 *      RTT to compute something pure is wasteful.
 *   2. The UI gate is a *hint*, never the security boundary. The server
 *      always re-checks on the mutation. Defence-in-depth: UI hides or
 *      disables a control; API rejects the request if the hint ever
 *      drifts. Same pattern `usePlanGating` uses for plan features.
 *
 * The hook returns a stable `Set<Permission>` plus a `can()` helper
 * that accepts the same `resource:action` permission strings as the
 * API's `requirePermission()` middleware — `organization:read`,
 * `event:view_analytics`, and so on.
 */

import { useMemo } from "react";
import {
  DEFAULT_ROLE_PERMISSIONS,
  hasPermission as hasPermissionInSet,
  type Permission,
  type UserRole,
} from "@teranga/shared-types";
import { useAuth } from "@/hooks/use-auth";

export interface PermissionCheck {
  /**
   * The raw permission set for the caller. Useful when a component
   * needs to render one of many branches and wants to pre-compute
   * the permission set once rather than calling `can()` repeatedly.
   */
  permissions: Set<Permission>;
  /** Does the caller hold the given permission (super_admin always does). */
  can: (permission: Permission) => boolean;
  /** True when the caller holds EVERY permission in the list. */
  canAll: (permissions: Permission[]) => boolean;
  /** True when the caller holds AT LEAST ONE of the permissions. */
  canAny: (permissions: Permission[]) => boolean;
}

function resolvePermissionsFromRoles(roles: readonly UserRole[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) {
    const perms = DEFAULT_ROLE_PERMISSIONS[role];
    if (!perms) continue;
    // `platform:manage` is the super-admin short-circuit — matches the
    // shared-types `resolvePermissions()` behaviour without allocating
    // a second Set only to merge it.
    if ((perms as readonly Permission[]).includes("platform:manage")) {
      out.add("platform:manage");
      return out;
    }
    for (const p of perms) out.add(p);
  }
  return out;
}

export function usePermissions(): PermissionCheck {
  const { user } = useAuth();

  const permissions = useMemo(() => resolvePermissionsFromRoles(user?.roles ?? []), [user?.roles]);

  const can = (permission: Permission): boolean => hasPermissionInSet(permissions, permission);

  const canAll = (perms: Permission[]): boolean => {
    if (permissions.has("platform:manage")) return true;
    return perms.every((p) => permissions.has(p));
  };

  const canAny = (perms: Permission[]): boolean => {
    if (permissions.has("platform:manage")) return true;
    return perms.some((p) => permissions.has(p));
  };

  return { permissions, can, canAll, canAny };
}
