"use client";

/**
 * Phase 1 — Persistent admin sidebar.
 *
 * Groups the back-office surface into 5 canonical SaaS-admin sections:
 *   1. Accueil      — task-oriented landing + read-only platform stats
 *   2. Client       — users, organizations, events, venues
 *   3. Billing      — plans, subscriptions, revenue
 *   4. Platform     — notifications, webhooks, jobs, feature flags, API keys, audit
 *   5. Settings     — admin team, announcements
 *
 * Design decisions:
 * - Collapse state is persisted per-browser in localStorage so an admin
 *   who prefers a compact sidebar keeps it across sessions.
 * - Active-route highlighting uses startsWith() so /admin/organizations/[id]
 *   highlights the parent "Organisations" entry.
 * - Groups are labelled (non-interactive) headers so the section boundary is
 *   visually obvious.
 * - Icons are from lucide-react to stay consistent with the rest of the app.
 * - Every item has a French label and an `aria-label` matching it.
 * - Routes that don't exist yet (Phase 6+) are included now so the IA looks
 *   right from day one; they render a "Bientôt" pill until they ship.
 */

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  LayoutDashboard,
  Users,
  Building2,
  CalendarDays,
  MapPin,
  Mail,
  CreditCard,
  Receipt,
  Coins,
  Tag,
  TrendingUp,
  Bell,
  Webhook,
  PlayCircle,
  Flag,
  KeyRound,
  ScrollText,
  UserCog,
  Megaphone,
  Activity,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@teranga/shared-ui";
import { cn } from "@/lib/utils";

// ─── Nav taxonomy ───────────────────────────────────────────────────────────

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Route doesn't exist yet — render a "Bientôt" pill. */
  comingSoon?: boolean;
};

type NavSection = {
  label: string | null; // null = no visible header (Accueil group)
  items: NavItem[];
};

const NAV: NavSection[] = [
  {
    label: null,
    items: [
      { href: "/admin/inbox", label: "Ma boîte", icon: Inbox },
      { href: "/admin/overview", label: "Vue d'ensemble", icon: LayoutDashboard },
    ],
  },
  {
    label: "Client",
    items: [
      { href: "/admin/users", label: "Utilisateurs", icon: Users },
      { href: "/admin/organizations", label: "Organisations", icon: Building2 },
      { href: "/admin/events", label: "Événements", icon: CalendarDays },
      { href: "/admin/venues", label: "Lieux", icon: MapPin },
      { href: "/admin/invites", label: "Invitations", icon: Mail },
    ],
  },
  {
    label: "Billing",
    items: [
      { href: "/admin/plans", label: "Plans", icon: CreditCard },
      { href: "/admin/coupons", label: "Coupons", icon: Tag },
      { href: "/admin/subscriptions", label: "Abonnements", icon: Receipt },
      { href: "/admin/payments", label: "Paiements", icon: Coins },
      { href: "/admin/revenue", label: "Revenus", icon: TrendingUp },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
      { href: "/admin/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/admin/jobs", label: "Jobs", icon: PlayCircle },
      { href: "/admin/scheduled-ops", label: "Planifications", icon: Clock },
      { href: "/admin/feature-flags", label: "Feature flags", icon: Flag },
      { href: "/admin/api-keys", label: "Clés API", icon: KeyRound },
      { href: "/admin/cost", label: "Coût Firestore", icon: Activity },
      { href: "/admin/audit", label: "Audit", icon: ScrollText },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/admin/settings/team", label: "Équipe admin", icon: UserCog },
      {
        href: "/admin/settings/announcements",
        label: "Annonces",
        icon: Megaphone,
      },
    ],
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

const COLLAPSED_KEY = "teranga:admin:sidebar:collapsed";

export function AdminSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Read localStorage on mount only (SSR-safe).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      /* localStorage unavailable (private mode, old browser) — default to expanded */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* same tolerance */
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-background transition-[width] duration-150",
        collapsed ? "w-14" : "w-60",
      )}
      aria-label="Navigation administration"
    >
      {/* Header with brand + collapse toggle */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-border px-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed && (
          <Link
            href="/admin/inbox"
            className="text-sm font-semibold tracking-tight text-foreground hover:text-teranga-gold"
            aria-label="Teranga Admin — aller à la boîte"
          >
            <span className="text-teranga-gold">Teranga</span>
            <span className="ml-1 text-muted-foreground">Admin</span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((section, idx) => (
          <div key={section.label ?? `group-${idx}`} className="mb-4 last:mb-0">
            {section.label && !collapsed && (
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </div>
            )}
            {section.label && collapsed && (
              <div
                className="mx-2 my-2 border-t border-border/50"
                aria-hidden="true"
                role="separator"
              />
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === pathname ||
                  (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    {item.comingSoon ? (
                      <div
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/50",
                          collapsed ? "justify-center" : "",
                        )}
                        aria-disabled="true"
                        title={`${item.label} — bientôt disponible`}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">{item.label}</span>
                            <Badge variant="outline" className="text-[9px]">
                              Bientôt
                            </Badge>
                          </>
                        )}
                      </div>
                    ) : (
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                          collapsed ? "justify-center" : "",
                          active
                            ? "bg-teranga-gold/10 font-medium text-teranga-gold"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                        aria-current={active ? "page" : undefined}
                        aria-label={item.label}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer — shortcut hint */}
      {!collapsed && (
        <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          Astuce :{" "}
          <kbd className="inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">
            ⌘K
          </kbd>{" "}
          pour la recherche rapide
        </div>
      )}
    </aside>
  );
}
