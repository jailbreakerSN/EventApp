"use client";

/**
 * Organizer overhaul — Phase O1.
 *
 * Single source of truth for the organizer-shell navigation taxonomy.
 *
 * Why a hook and not a static export:
 *  - The taxonomy itself is static (5 sections with a fixed item set), but
 *    every consumer (sidebar, command palette, event switcher, breadcrumbs)
 *    needs the SAME view-model: items already filtered by the caller's
 *    roles. Centralising the filter here means a "co-organizer" never sees
 *    a Finance entry in the sidebar AND never gets a `/finance` suggestion
 *    in the palette. Drift between those surfaces was the symptom O1
 *    closes (cf. PLAN.md §3.2 friction F1).
 *  - The hook is `useMemo`-based on `user.roles` so re-renders are free
 *    once the role list stabilises post-login.
 *
 * Mirror of `useAdminRole` for the admin shell. The two hooks intentionally
 * stay separate — the organizer surface has its own role taxonomy
 * (organizer / co_organizer / venue_manager) and a different set of
 * gating rules (plan-feature dependent for some entries).
 */

import { useMemo } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  QrCode,
  BarChart3,
  Wallet,
  Megaphone,
  Bell,
  Building2,
  CreditCard,
  Settings,
  MapPin,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@teranga/shared-types";
import { useAuth } from "@/hooks/use-auth";

export type OrganizerSectionKey =
  | "my-space"
  | "events"
  | "audience"
  | "business"
  | "settings"
  | "venues";

export interface OrganizerNavItem {
  /** Stable identifier — used as React key + analytics token. */
  id: string;
  /** Destination route. Must start with `/`. */
  href: string;
  /** Lucide icon component. Rendered at 17 px in the sidebar, 16 px in the palette. */
  icon: LucideIcon;
  /** French label shown in the sidebar / palette. */
  label: string;
  /** Optional French description shown in the command palette. */
  description?: string;
  /** Roles that may see the item. ORed — caller needs at least one. */
  roles: readonly UserRole[];
  /** Optional keyboard shortcut hint shown in the palette (e.g. `g i`). */
  shortcut?: string;
  /**
   * Whether the item is shown in the global Cmd+K command palette.
   * Defaults to `true`. Set to `false` for entries that don't make
   * sense as a navigation target on their own (none today, kept for
   * future "section anchor" entries).
   */
  inPalette?: boolean;
  /**
   * When `true`, the entry renders as a non-navigable, dimmed row
   * (sidebar) and is filtered out of the command palette. Used to
   * advertise upcoming surfaces — e.g. `/inbox` lives in the taxonomy
   * during O1 so the section header is non-empty and operators see
   * what's coming, but the route itself only lands in O2. Mirrors the
   * `comingSoon` pattern in `admin-sidebar.tsx`.
   */
  comingSoon?: boolean;
}

export interface OrganizerNavSection {
  key: OrganizerSectionKey;
  /** French label rendered as a section header in the sidebar. */
  label: string;
  /** Items already filtered to the caller's roles. */
  items: readonly OrganizerNavItem[];
}

export interface OrganizerNavContext {
  /** All sections, items already role-filtered. Empty sections are pruned. */
  sections: readonly OrganizerNavSection[];
  /** Flat list of every visible item — convenient for the command palette. */
  allItems: readonly OrganizerNavItem[];
  /** True when the caller is a co-organizer (no organization-wide chrome). */
  isCoOrganizer: boolean;
  /** True when the caller is a venue_manager (sees venues section only). */
  isVenueManager: boolean;
}

/**
 * Static taxonomy. Order in the array = order in the sidebar.
 *
 * Section keys map to the five-section information architecture defined
 * in `docs/organizer-overhaul/PLAN.md` §5 phase O1.
 *
 * The Inbox entry is reserved for phase O2 — when the page lands the
 * `comingSoon: true` flag is replaced by a real route. Keeping it in
 * the taxonomy now makes the section header non-empty for organizers
 * and signals the upcoming surface to operators reading the code.
 *
 * NOTE on plan-feature gating: items like Analytics or Finance live
 * under a `PlanGate` at the page level — keeping them VISIBLE in the
 * sidebar is intentional. A free-tier organizer who clicks Analytics
 * lands on a page with a soft-paywall and an upgrade CTA, which is the
 * Teranga gating doctrine (cf. CLAUDE.md "Defer to plan gating, never
 * to hiding"). The sidebar must never silently hide a feature that
 * the upgrade flow can unlock.
 */
const TAXONOMY_BUILDER: () => readonly OrganizerNavSection[] = () => [
  {
    key: "my-space",
    label: "Mon espace",
    items: [
      {
        id: "inbox",
        href: "/inbox",
        icon: Inbox,
        label: "Boîte de tâches",
        description: "Vos actions du jour, classées par priorité",
        roles: ["organizer", "co_organizer", "super_admin"] as const,
        shortcut: "g i",
      },
      {
        id: "dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        label: "Tableau de bord",
        description: "Vue d'ensemble de votre activité",
        roles: ["organizer", "co_organizer", "super_admin"] as const,
        shortcut: "g d",
      },
    ],
  },
  {
    key: "events",
    label: "Événements",
    items: [
      {
        id: "events",
        href: "/events",
        icon: CalendarDays,
        label: "Tous les événements",
        description: "Liste, recherche, et création d'événements",
        roles: ["organizer", "co_organizer", "super_admin"] as const,
        shortcut: "g e",
      },
      {
        id: "badges",
        href: "/badges",
        icon: QrCode,
        label: "Badges & QR",
        description: "Génération et gabarits de badges",
        roles: ["organizer", "super_admin"] as const,
        shortcut: "g b",
      },
    ],
  },
  {
    key: "audience",
    label: "Audience",
    items: [
      {
        id: "participants",
        href: "/participants",
        icon: Users,
        label: "Participants",
        description: "Annuaire cross-événements de vos inscrits",
        roles: ["organizer", "super_admin"] as const,
        shortcut: "g p",
      },
      {
        id: "communications",
        href: "/communications",
        icon: Megaphone,
        label: "Communications",
        description: "Broadcasts, rappels, templates",
        roles: ["organizer", "co_organizer", "super_admin"] as const,
        shortcut: "g c",
      },
      {
        id: "notifications",
        href: "/notifications",
        icon: Bell,
        label: "Notifications",
        description: "Historique des notifications envoyées",
        roles: ["organizer", "co_organizer", "super_admin"] as const,
        shortcut: "g n",
      },
    ],
  },
  {
    key: "business",
    label: "Business",
    items: [
      {
        id: "analytics",
        href: "/analytics",
        icon: BarChart3,
        label: "Analytiques",
        description: "Performance, cohortes, conversion",
        roles: ["organizer", "super_admin"] as const,
        shortcut: "g a",
      },
      {
        id: "finance",
        href: "/finance",
        icon: Wallet,
        label: "Finances",
        description: "Revenus, paiements, payouts",
        roles: ["organizer", "super_admin"] as const,
        shortcut: "g f",
      },
      {
        id: "organization",
        href: "/organization",
        icon: Building2,
        label: "Organisation",
        description: "Équipe, invitations, rôles",
        roles: ["organizer", "super_admin"] as const,
        shortcut: "g o",
      },
    ],
  },
  {
    key: "venues",
    label: "Lieux",
    items: [
      {
        id: "venues",
        href: "/venues",
        icon: MapPin,
        label: "Mes lieux",
        description: "Salles, configurations, disponibilités",
        roles: ["venue_manager", "super_admin"] as const,
      },
    ],
  },
  {
    key: "settings",
    label: "Paramètres",
    items: [
      {
        id: "billing",
        href: "/organization/billing",
        icon: CreditCard,
        label: "Facturation",
        description: "Plan, usage, factures",
        roles: ["organizer", "super_admin"] as const,
        shortcut: "g $",
      },
      {
        id: "settings",
        href: "/settings",
        icon: Settings,
        label: "Préférences",
        description: "Langue, notifications, sécurité",
        roles: ["organizer", "co_organizer", "super_admin"] as const,
        shortcut: "g s",
      },
    ],
  },
];

/** Pure function — exported for unit tests. Filters the taxonomy by roles. */
export function buildOrganizerNav(roles: readonly UserRole[]): OrganizerNavContext {
  const taxonomy = TAXONOMY_BUILDER();
  const roleSet = new Set<string>(roles);

  const sections: OrganizerNavSection[] = [];
  const allItems: OrganizerNavItem[] = [];

  for (const section of taxonomy) {
    const visibleItems = section.items.filter((item) =>
      item.roles.some((r) => roleSet.has(r as string)),
    );
    if (visibleItems.length === 0) continue;
    sections.push({ key: section.key, label: section.label, items: visibleItems });
    allItems.push(...visibleItems);
  }

  const isCoOrganizer = roleSet.has("co_organizer") && !roleSet.has("organizer");
  const isVenueManager =
    roleSet.has("venue_manager") &&
    !roleSet.has("organizer") &&
    !roleSet.has("co_organizer") &&
    !roleSet.has("super_admin");

  return { sections, allItems, isCoOrganizer, isVenueManager };
}

/**
 * React hook returning the role-filtered organizer navigation.
 *
 * Usage:
 *
 *   const { sections, allItems, isCoOrganizer } = useOrganizerNav();
 *
 *   // Sidebar rendering
 *   sections.map(section => <NavGroup section={section} />)
 *
 *   // Command palette
 *   allItems.map(item => <PaletteEntry item={item} />)
 *
 * Returns a stable reference for the same `user.roles` input — safe to
 * use as a dependency in downstream hooks.
 */
export function useOrganizerNav(): OrganizerNavContext {
  const { user } = useAuth();
  // useAuth's user object identity is stable across renders for the
  // same authenticated session, so depending on `user?.roles` directly
  // is safe — same pattern as `usePermissions`.
  return useMemo<OrganizerNavContext>(() => buildOrganizerNav(user?.roles ?? []), [user?.roles]);
}
