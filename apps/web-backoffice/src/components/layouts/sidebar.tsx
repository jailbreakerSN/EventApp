"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Bell,
  Settings,
  Building2,
  QrCode,
  BarChart3,
  Wallet,
  Megaphone,
  X,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useSidebar } from "./sidebar-context";
import { usePlanGating } from "@/hooks/use-plan-gating";
import { UsageMeter } from "@/components/plan/UsageMeter";
import type { UserRole } from "@teranga/shared-types";
import { usePlansCatalogMap, getPlanDisplay } from "@/hooks/use-plans-catalog";
import { CreditCard, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  {
    href: "/dashboard",
    icon: LayoutDashboard,
    label: "Tableau de bord",
    roles: ["organizer", "co_organizer", "super_admin"],
  },
  {
    href: "/events",
    icon: CalendarDays,
    label: "Événements",
    roles: ["organizer", "co_organizer", "super_admin"],
  },
  {
    href: "/participants",
    icon: Users,
    label: "Participants",
    roles: ["organizer", "super_admin"],
  },
  { href: "/badges", icon: QrCode, label: "Badges & QR", roles: ["organizer", "super_admin"] },
  {
    href: "/analytics",
    icon: BarChart3,
    label: "Analytiques",
    roles: ["organizer", "super_admin"],
  },
  { href: "/finance", icon: Wallet, label: "Finances", roles: ["organizer", "super_admin"] },
  {
    href: "/communications",
    icon: Megaphone,
    label: "Communications",
    roles: ["organizer", "co_organizer", "super_admin"],
  },
  {
    href: "/notifications",
    icon: Bell,
    label: "Notifications",
    roles: ["organizer", "co_organizer", "super_admin"],
  },
  {
    href: "/organization",
    icon: Building2,
    label: "Organisation",
    roles: ["organizer", "super_admin"],
  },
  {
    href: "/organization/billing",
    icon: CreditCard,
    label: "Facturation",
    roles: ["organizer", "super_admin"],
  },
  { href: "/settings", icon: Settings, label: "Paramètres", roles: ["organizer", "super_admin"] },
];

const venueNavItems: NavItem[] = [
  { href: "/venues", icon: MapPin, label: "Mes Lieux", roles: ["venue_manager", "super_admin"] },
];

// NOTE: the admin section used to be rendered inside this sidebar. It
// was removed when the admin shell moved to its own (admin) route group
// — see commit af3636e "refactor(shell): split admin into dedicated
// (admin) route group". An admin user now reaches /admin/inbox either
// (a) by landing there after login (resolveLandingRoute in lib/access.ts)
// or (b) via the "Administration" pill rendered in the top bar when
// useAdminRole() is truthy. Never re-add admin entries here or the
// nested-shell UX bug returns.

export function Sidebar() {
  const pathname = usePathname();
  const { hasRole } = useAuth();
  const { isOpen, close } = useSidebar();

  const visibleItems = navItems.filter((item) => hasRole(...item.roles));

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
      {/* Logo */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
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
        {/* Close button — mobile only */}
        <button
          onClick={close}
          className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 motion-safe:transition-colors"
          aria-label="Fermer le menu"
        >
          <X size={18} className="text-white/60" />
        </button>
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto"
        aria-label="Navigation principale"
      >
        {visibleItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm motion-safe:transition-colors",
                isActive
                  ? "bg-white/15 text-white font-medium"
                  : "text-white/60 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
            </Link>
          );
        })}

        {/* Venue section — venue_manager + super_admin */}
        {hasRole("venue_manager", "super_admin") && (
          <>
            <div className="my-3 mx-3 border-t border-white/10" />
            <p className="px-3 text-[10px] text-white/40 uppercase tracking-wider mb-1">Lieux</p>
            {venueNavItems
              .filter((item) => hasRole(...item.roles))
              .map(({ href, icon: Icon, label }) => {
                const isActive = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm motion-safe:transition-colors",
                      isActive
                        ? "bg-white/15 text-white font-medium"
                        : "text-white/60 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Icon size={17} aria-hidden="true" />
                    {label}
                  </Link>
                );
              })}
          </>
        )}

        {/* Admin entries used to render here. Intentionally removed —
            admins reach /admin/* via the dedicated shell in the
            (admin) route group, triggered by the "Administration" pill
            in the top bar. See lib/access.ts + components/layouts/topbar.tsx. */}
      </nav>

      {/* Plan widget */}
      <SidebarPlanWidget />
    </>
  );

  return (
    <>
      {/* Desktop sidebar — always visible at lg+ */}
      <aside
        className="hidden lg:flex w-60 bg-sidebar text-sidebar-foreground flex-col h-full shrink-0"
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

      {/* Mobile drawer */}
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
        {sidebarContent}
      </aside>
    </>
  );
}

function SidebarPlanWidget() {
  const _t = useTranslations("common");
  void _t;
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
              Upgrade <ArrowUpRight className="h-2.5 w-2.5" />
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
