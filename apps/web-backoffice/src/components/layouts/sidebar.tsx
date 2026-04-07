"use client";

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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import type { UserRole } from "@teranga/shared-types";

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  roles: UserRole[]; // which roles can see this item
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

export function Sidebar() {
  const pathname = usePathname();
  const { hasRole } = useAuth();

  const visibleItems = navItems.filter((item) =>
    hasRole(...item.roles)
  );

  return (
    <aside className="w-60 bg-sidebar text-sidebar-foreground flex flex-col h-full shrink-0">
      {/* Logo */}
      <div className="px-6 py-4 border-b border-white/10">
        <Image src="/logo-white.svg" alt="Teranga Event" width={140} height={83} className="h-10 w-auto" priority />
        <span className="text-white/50 text-[10px] block mt-0.5 tracking-wider uppercase">Back-office</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-white/15 text-white font-medium"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            )}
          >
            <Icon size={17} />
            {label}
          </Link>
        ))}
      </nav>

      {/* Plan badge */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="bg-secondary/15 rounded-lg p-3">
          <p className="text-secondary text-xs font-semibold">Plan Gratuit</p>
          <p className="text-white/50 text-xs mt-0.5">2 événements / mois</p>
        </div>
      </div>
    </aside>
  );
}
