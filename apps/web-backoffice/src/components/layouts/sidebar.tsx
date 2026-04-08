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
  Shield,
  MapPin,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useSidebar } from "./sidebar-context";
import type { UserRole } from "@teranga/shared-types";

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Tableau de bord", roles: ["organizer", "co_organizer", "super_admin"] },
  { href: "/events", icon: CalendarDays, label: "Événements", roles: ["organizer", "co_organizer", "super_admin"] },
  { href: "/participants", icon: Users, label: "Participants", roles: ["organizer", "super_admin"] },
  { href: "/badges", icon: QrCode, label: "Badges & QR", roles: ["organizer", "super_admin"] },
  { href: "/analytics", icon: BarChart3, label: "Analytiques", roles: ["organizer", "super_admin"] },
  { href: "/finance", icon: Wallet, label: "Finances", roles: ["organizer", "super_admin"] },
  { href: "/communications", icon: Megaphone, label: "Communications", roles: ["organizer", "co_organizer", "super_admin"] },
  { href: "/notifications", icon: Bell, label: "Notifications", roles: ["organizer", "co_organizer", "super_admin"] },
  { href: "/organization", icon: Building2, label: "Organisation", roles: ["organizer", "super_admin"] },
  { href: "/settings", icon: Settings, label: "Paramètres", roles: ["organizer", "super_admin"] },
];

const venueNavItems: NavItem[] = [
  { href: "/venues", icon: MapPin, label: "Mes Lieux", roles: ["venue_manager", "super_admin"] },
];

const adminNavItems: NavItem[] = [
  { href: "/admin", icon: Shield, label: "Admin Plateforme", roles: ["super_admin"] },
  { href: "/admin/users", icon: Users, label: "Utilisateurs", roles: ["super_admin"] },
  { href: "/admin/organizations", icon: Building2, label: "Organisations", roles: ["super_admin"] },
  { href: "/admin/events", icon: CalendarDays, label: "Événements (tous)", roles: ["super_admin"] },
  { href: "/admin/venues", icon: MapPin, label: "Lieux", roles: ["super_admin"] },
  { href: "/admin/audit", icon: FileText, label: "Journal d'audit", roles: ["super_admin"] },
];

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
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <div>
          <Image src="/logo-white.svg" alt="Teranga Event" width={140} height={83} className="h-10 w-auto" priority />
          <span className="text-white/50 text-[10px] block mt-0.5 tracking-wider uppercase">Back-office</span>
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
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
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
                  : "text-white/60 hover:bg-white/10 hover:text-white"
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
            {venueNavItems.filter((item) => hasRole(...item.roles)).map(({ href, icon: Icon, label }) => {
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
                      : "text-white/60 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon size={17} aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </>
        )}

        {/* Admin section — super_admin only */}
        {hasRole("super_admin") && (
          <>
            <div className="my-3 mx-3 border-t border-white/10" />
            <p className="px-3 text-[10px] text-white/40 uppercase tracking-wider mb-1">Administration</p>
            {adminNavItems.map(({ href, icon: Icon, label }) => {
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
                      : "text-white/60 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon size={17} aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* Plan badge */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="bg-secondary/15 rounded-lg p-3">
          <p className="text-secondary text-xs font-semibold">Plan Gratuit</p>
          <p className="text-white/50 text-xs mt-0.5">2 événements / mois</p>
        </div>
      </div>
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
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
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
          isOpen ? "translate-x-0" : "-translate-x-full"
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
