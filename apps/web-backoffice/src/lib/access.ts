/**
 * Single source of truth for backoffice access decisions.
 *
 * Two concerns meet here:
 *  1. **Role taxonomy** — which roles constitute "admin", "organizer",
 *     "venue manager" for the purposes of the backoffice UI shell.
 *  2. **Landing routing** — given a freshly-authenticated user, which
 *     URL is their natural home.
 *
 * Both concerns are shared by the login form (redirect after sign-in),
 * the `(dashboard)/layout.tsx` access gate, and the `(admin)/admin/layout.tsx`
 * gate. Keeping them here avoids drift between the three call-sites.
 *
 * Design notes:
 *  - `ADMIN_ROLES` matches `AdminRole` in `src/hooks/use-admin-role.ts`
 *    and `BACKOFFICE_ROLES` in `(dashboard)/layout.tsx`. If a new admin
 *    role lands (closure C added five `platform:*` subroles), it only
 *    needs to be added HERE and the three consumers inherit the change.
 *  - `resolveLandingRoute` prefers the admin shell when the user holds
 *    any admin role — that is the user's highest-privilege context and
 *    the one they are most likely to want immediately. A super-admin
 *    who also wears an organizer hat (dev test accounts) can switch
 *    contexts via the top-bar affordance.
 */

import type { UserRole } from "@teranga/shared-types";

/** Every role that grants access to `/admin/*`. */
export const ADMIN_ROLES: readonly UserRole[] = [
  "super_admin",
  "platform:super_admin",
  "platform:support",
  "platform:finance",
  "platform:ops",
  "platform:security",
] as const;

/** Every role that grants access to the organizer shell (`/dashboard`, `/events`, …). */
export const ORGANIZER_ROLES: readonly UserRole[] = ["organizer", "co_organizer"] as const;

/** Roles scoped to the venue-management surface (`/venues`). */
export const VENUE_ROLES: readonly UserRole[] = ["venue_manager"] as const;

/**
 * Every role that may traverse ANY backoffice URL — union of admin,
 * organizer, and venue roles. Used by the `(dashboard)/layout.tsx`
 * gate and the login-form redirect guard. The organizer sidebar then
 * filters items inside the shell on a finer per-item role list.
 */
export const BACKOFFICE_ROLES: readonly UserRole[] = [
  ...ADMIN_ROLES,
  ...ORGANIZER_ROLES,
  ...VENUE_ROLES,
] as const;

export function hasAnyRole(userRoles: readonly UserRole[], target: readonly UserRole[]): boolean {
  return userRoles.some((r) => target.includes(r));
}

export function isAdminRole(userRoles: readonly UserRole[]): boolean {
  return hasAnyRole(userRoles, ADMIN_ROLES);
}

export function isOrganizerRole(userRoles: readonly UserRole[]): boolean {
  return hasAnyRole(userRoles, ORGANIZER_ROLES);
}

export function isVenueRole(userRoles: readonly UserRole[]): boolean {
  return hasAnyRole(userRoles, VENUE_ROLES);
}

/**
 * Does this caller have a reason to traverse the organizer shell?
 * True when they hold an organizer/co_organizer role (primary persona
 * of /dashboard) OR a venue_manager role (for whom /venues lives in
 * the same shell). False for pure admins — they would land on an
 * empty sidebar. Consumed by the "Voir comme organisateur" menu-item
 * guard in the admin shell so the affordance only shows for users who
 * actually have something to do in the organizer shell.
 */
export function canViewOrganizerShell(userRoles: readonly UserRole[]): boolean {
  return isOrganizerRole(userRoles) || isVenueRole(userRoles);
}

/**
 * Resolve the preferred landing route for a freshly-authenticated user.
 *
 * Priority order:
 *  1. Admin roles — super-admins land on `/admin/inbox` (their task-
 *     oriented home). A super-admin who also holds `organizer` can
 *     cross over to `/dashboard` via the topbar "Voir comme organisateur"
 *     switcher.
 *  2. Organizer roles — `/dashboard`.
 *  3. Venue-only roles — `/venues`.
 *  4. Anything else — `/unauthorized`.
 */
export function resolveLandingRoute(userRoles: readonly UserRole[]): string {
  if (isAdminRole(userRoles)) return "/admin/inbox";
  if (isOrganizerRole(userRoles)) return "/dashboard";
  if (isVenueRole(userRoles)) return "/venues";
  return "/unauthorized";
}
