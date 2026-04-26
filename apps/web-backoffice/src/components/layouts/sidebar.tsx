"use client";

/**
 * Organizer overhaul — Phase O1.
 *
 * Sidebar restructured around the five-section information architecture
 * (Mon espace / Événements / Audience / Business / Paramètres + Lieux for
 * venue managers). The taxonomy itself lives in `useOrganizerNav()` so
 * sidebar, command palette, event switcher, and breadcrumbs stay in
 * lockstep — adding a route in ONE place propagates to every surface.
 *
 * Visual contract:
 *  - Section headers (10px, uppercase, white/40) act as cognitive
 *    anchors so an organizer scanning the rail recognises "where" she
 *    is heading rather than reading a flat 11-item list.
 *  - Collapse state is persisted per-browser in localStorage (key
 *    `teranga:organizer:sidebar:collapsed`). The toggle lives in the
 *    header next to the brand. Mirrors the admin shell decision
 *    (cf. `admin-sidebar.tsx`).
 *  - Plan widget remains pinned at the bottom — only mounted for callers
 *    who can read the organisation, hidden for venue managers and pure
 *    co-organizers (who do not own billing).
 *  - Mobile drawer (translateX) and desktop static rail share the same
 *    inner content via the `sidebarContent` JSX node.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { CreditCard, ArrowUpRight, X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { useOrganizerNav, type OrganizerNavItem } from "@/hooks/use-organizer-nav";
import { usePlanGating } from "@/hooks/use-plan-gating";
import { usePermissions } from "@/hooks/use-permissions";
import { UsageMeter } from "@/components/plan/UsageMeter";
import { usePlansCatalogMap, getPlanDisplay } from "@/hooks/use-plans-catalog";
// `useTranslations` import removed: this file ships hardcoded French
// strings consistent with the rest of the organizer-overhaul (O1-O10)
// pattern. The next-intl migration is tracked as a separate
// cross-cutting effort. Earlier the import + a dead hook call lived
// here as a placeholder; cleaned during the senior review pass.

const COLLAPSED_KEY = "teranga:organizer:sidebar:collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const { isOpen, close } = useSidebar();
  const { sections } = useOrganizerNav();

  // Desktop collapsed state (persisted). Mobile drawer uses
  // `useSidebar()` for its open/close state — the two are independent
  // because the mobile drawer always starts closed on a fresh page
  // load while the desktop preference is sticky.
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

  const toggleCollapsed = () => {
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

  // Close sidebar on route change (mobile)
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, close]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const sidebarContent = (
    <>
      {/* Logo + collapse toggle */}
      <div
        className={cn(
          "border-b border-white/10 flex items-center",
          collapsed ? "px-3 py-4 justify-center" : "px-6 py-4 justify-between",
        )}
      >
        {!collapsed && (
          <div>
            <Image
              src="/logo-white.svg"
              alt="Teranga Event"
              width={140}
              height={83}
              className="h-10 w-auto"
              priority
            />
            <span className="text-white/50 text-[10px] block mt-0.5 tracking-wider uppercase">
              Back-office
            </span>
          </div>
        )}
        {/* Desktop collapse toggle — hidden on mobile (the drawer has its own X) */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}
          aria-pressed={collapsed}
          className="hidden lg:inline-flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white motion-safe:transition-colors"
        >
          {collapsed ? (
            <ChevronRight size={16} aria-hidden="true" />
          ) : (
            <ChevronLeft size={16} aria-hidden="true" />
          )}
        </button>
        {/* Close button — mobile drawer only */}
        <button
          onClick={close}
          className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 motion-safe:transition-colors"
          aria-label="Fermer le menu"
        >
          <X size={18} className="text-white/60" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto" aria-label="Navigation principale">
        {sections.map((section, idx) => (
          <div key={section.key} className={cn(idx === 0 ? "" : "mt-4")}>
            {/* Section header — hidden when collapsed (replaced by separator) */}
            {!collapsed ? (
              <p className="px-3 text-[10px] text-white/40 uppercase tracking-wider mb-1">
                {section.label}
              </p>
            ) : (
              idx > 0 && (
                <div
                  className="mx-2 my-2 border-t border-white/10"
                  aria-hidden="true"
                  role="separator"
                />
              )
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarItem key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Plan widget — only for callers who can actually read the
          organization (`organization:read`). Venue managers hold
          venue:* permissions but no org-read, and the plan widget
          fires `/organizations/:id` + `/organizations/:id/usage` under
          the hood — unconditional mounting produces a 403 storm in
          their console. Hiding the widget is the honest signal: they
          don't own the billing relationship. Also hidden when
          collapsed because the meters need the rail's full width. */}
      {!collapsed && <SidebarPlanWidgetGate />}
    </>
  );

  return (
    <>
      {/* Desktop sidebar — always visible at lg+ */}
      <aside
        className={cn(
          "hidden lg:flex bg-sidebar text-sidebar-foreground flex-col h-full shrink-0 motion-safe:transition-[width] motion-safe:duration-150",
          collapsed ? "w-14" : "w-60",
        )}
        role="navigation"
        aria-label="Navigation principale"
      >
        {sidebarContent}
      </aside>

      {/* Mobile backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 lg:hidden motion-safe:transition-opacity",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* Mobile drawer — always full width, ignores the desktop collapse */}
      <aside
        id="mobile-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-60 bg-sidebar text-sidebar-foreground flex flex-col lg:hidden",
          "motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
        role="navigation"
        aria-label="Navigation principale"
        aria-hidden={!isOpen}
      >
        {/* Force-expand state for the mobile drawer regardless of the
            desktop preference — the drawer is short-lived and full-width. */}
        <MobileSidebarContent>{sidebarContent}</MobileSidebarContent>
      </aside>
    </>
  );
}

function MobileSidebarContent({ children }: { children: React.ReactNode }) {
  // Wrapper exists so future mobile-specific affordances (e.g. a search
  // bar pinned to the top of the drawer) have a clear injection point.
  return <>{children}</>;
}

interface SidebarItemProps {
  item: OrganizerNavItem;
  pathname: string;
  collapsed: boolean;
}

function SidebarItem({ item, pathname, collapsed }: SidebarItemProps) {
  const Icon = item.icon;
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

  if (item.comingSoon) {
    return (
      <div
        className={cn(
          "flex items-center rounded-lg text-sm text-white/30 cursor-default",
          collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
        )}
        aria-disabled="true"
        title={collapsed ? `${item.label} — bientôt disponible` : "Bientôt disponible"}
      >
        <Icon size={17} aria-hidden="true" />
        {!collapsed && (
          <>
            <span className="truncate flex-1">{item.label}</span>
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 shrink-0">
              Bientôt
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center rounded-lg text-sm motion-safe:transition-colors",
        collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
        isActive
          ? "bg-white/15 text-white font-medium"
          : "text-white/60 hover:bg-white/10 hover:text-white",
      )}
    >
      <Icon size={17} aria-hidden="true" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

// Permission-gated wrapper: cheap check runs every render so the
// expensive plan-gating hook (two network calls) only mounts for
// callers who can actually read the org. Venue managers + staff fall
// through to null and the sidebar ends without a plan box.
function SidebarPlanWidgetGate() {
  const { can } = usePermissions();
  if (!can("organization:read")) return null;
  return <SidebarPlanWidget />;
}

function SidebarPlanWidget() {
  const { plan, checkLimit, isNearLimit } = usePlanGating();
  const { map: catalog } = usePlansCatalogMap();
  const display = getPlanDisplay(plan, catalog);
  const events = checkLimit("events");
  const members = checkLimit("members");

  return (
    <div className="px-4 py-4 border-t border-white/10">
      <div className="bg-white/5 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-secondary text-xs font-semibold">{display.name.fr}</p>
          {plan === "free" && (
            <Link
              href="/organization/billing"
              className="inline-flex items-center gap-0.5 text-[10px] text-secondary hover:text-secondary/80 transition-colors"
            >
              Évoluer <ArrowUpRight className="h-2.5 w-2.5" />
            </Link>
          )}
        </div>
        <div className="space-y-2 [&_span]:text-white/50 [&_div]:bg-white/10">
          <UsageMeter label="Événements" current={events.current} limit={events.limit} compact />
          <UsageMeter label="Membres" current={members.current} limit={members.limit} compact />
        </div>
        {(isNearLimit("events") || isNearLimit("members")) && plan !== "enterprise" && (
          <Link
            href="/organization/billing"
            className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 bg-secondary/20 text-secondary text-xs font-medium rounded-md hover:bg-secondary/30 transition-colors"
          >
            <CreditCard className="h-3 w-3" />
            Augmenter mes limites
          </Link>
        )}
      </div>
    </div>
  );
}
