"use client";

/**
 * Phase 1 closure — single source of truth for "who is the active admin".
 *
 * Exposes the caller's effective admin role (super_admin or any of the
 * new platform:* roles introduced in Phase 4 closure) with a stable
 * label for the top-bar pill + predicates for role-gated UI. Works on
 * top of the existing `useAuth()` session — purely a derivation layer,
 * no extra network calls.
 *
 * The hook returns `null` for non-admin callers so gated components
 * (e.g. "Delete org" buttons) can short-circuit cleanly:
 *
 *   const adminRole = useAdminRole();
 *   if (!adminRole) return null;
 *
 * The original plan asked for a dedicated `use-admin-role.ts` during
 * Phase 1 of the overhaul; the Phase 1 commit inlined the logic into
 * `admin/layout.tsx`. Closing that gap here so future admin pages have
 * a clean API to check "is this user platform:finance?" without
 * re-reading the claims blob.
 */

import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { ADMIN_ROLES } from "@/lib/access";

/**
 * Every role routed through `/admin/*`. Derived from the shared
 * `ADMIN_ROLES` list in `@/lib/access` so there is exactly ONE place
 * to edit when a new admin subrole lands. Before closure F2 these
 * were two independently-enumerated lists that were already shown to
 * drift (same role set, two declaration sites).
 */
export type AdminRole = (typeof ADMIN_ROLES)[number];

const ADMIN_ROLE_SET = new Set<AdminRole>(ADMIN_ROLES);

const LABEL: Record<AdminRole, string> = {
  super_admin: "Super admin",
  "platform:super_admin": "Super admin",
  "platform:support": "Support",
  "platform:finance": "Finance",
  "platform:ops": "Ops",
  "platform:security": "Sécurité",
};

export interface AdminRoleContext {
  /** The narrowest admin role the caller holds. */
  role: AdminRole;
  /** Human label to display in banners / pills. */
  label: string;
  /** Every admin role the caller holds (a user can hold several). */
  allRoles: AdminRole[];
  /** Convenience — has any platform:super_admin or super_admin rights. */
  isSuperAdmin: boolean;
  /** Predicate for role-gated UI. */
  is: (role: AdminRole) => boolean;
}

export function useAdminRole(): AdminRoleContext | null {
  const { user } = useAuth();

  return useMemo<AdminRoleContext | null>(() => {
    if (!user) return null;
    const matching = user.roles.filter((r): r is AdminRole => ADMIN_ROLE_SET.has(r as AdminRole));
    if (matching.length === 0) return null;

    // Narrowest role = prefer platform:* over legacy super_admin so
    // audit labels reflect the team assignment when one exists.
    const preferred: AdminRole = matching.find((r) => r !== "super_admin") ?? matching[0];

    return {
      role: preferred,
      label: LABEL[preferred],
      allRoles: matching,
      isSuperAdmin: matching.includes("super_admin") || matching.includes("platform:super_admin"),
      is: (role) => matching.includes(role),
    };
  }, [user]);
}
