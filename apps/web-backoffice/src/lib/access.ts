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

import type { UserRole, AdminSystemRole } from "@teranga/shared-types";
import { ADMIN_SYSTEM_ROLES } from "@teranga/shared-types";

/**
 * Every role that grants access to `/admin/*`.
 *
 * Sourced from `ADMIN_SYSTEM_ROLES` in `@teranga/shared-types` so the
 * API `requireEmailVerified` middleware, the `useAdminRole()` hook,
 * and this access module all read from ONE canonical list — a single
 * rename/add here propagates everywhere. Before this unification
 * (PR #163 review), the list was enumerated in three places and had
 * already produced one production-relevant drift (see commit 1e3e832).
 *
 * The tuple type is preserved (not widened to `UserRole[]`) so
 * consumers like `use-admin-role.ts` can derive the narrow
 * `AdminRole` union via `(typeof ADMIN_ROLES)[number]`.
 */
export const ADMIN_ROLES: readonly AdminSystemRole[] = ADMIN_SYSTEM_ROLES;

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
 *  2. Organizer roles — `/inbox` (Phase O2 task-oriented landing — see
 *     docs/organizer-overhaul/PLAN.md). Pre-O2 this returned `/dashboard`,
 *     which is a metric panel rather than a "what needs me today?"
 *     surface; the inbox replaces it as the post-login default.
 *  3. Venue-only roles — `/venues`.
 *  4. Anything else — `/unauthorized`.
 *
 * TODO(permissions-tightening): today every `platform:*` subrole maps
 * to `platform:manage` (see DEFAULT_ROLE_PERMISSIONS in
 * packages/shared-types/src/permissions.types.ts around line 353).
 * When the "narrowing per-route" follow-up shipped in closure C.1
 * lands — e.g. `platform:finance` no longer holding `platform:manage`
 * and instead holding only `subscription:*` — this function will send
 * a finance admin to `/admin/inbox` where most sub-pages 403 them.
 * Migrate to landing on a role-scoped home (e.g. `/admin/revenue` for
 * finance, `/admin/audit` for security) at the same time you split
 * the permission map. Tracked alongside closure C.1 — no action today,
 * but the two MUST move together.
 */
export function resolveLandingRoute(userRoles: readonly UserRole[]): string {
  if (isAdminRole(userRoles)) return "/admin/inbox";
  if (isOrganizerRole(userRoles)) return "/inbox";
  if (isVenueRole(userRoles)) return "/venues";
  return "/unauthorized";
}
