"use client";

import Link from "next/link";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Tableau de bord" },
  { href: "/events", icon: CalendarDays, label: "Événements" },
  { href: "/participants", icon: Users, label: "Participants" },
  { href: "/badges", icon: QrCode, label: "Badges & QR" },
  { href: "/analytics", icon: BarChart3, label: "Analytiques" },
  { href: "/notifications", icon: Bell, label: "Notifications" },
  { href: "/organization", icon: Building2, label: "Organisation" },
  { href: "/settings", icon: Settings, label: "Paramètres" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-[#1A1A2E] flex flex-col h-full shrink-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <span className="text-white text-xl font-bold tracking-tight">Teranga</span>
        <span className="text-[#F5A623] text-xs block -mt-0.5">Back-office</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label }) => (
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
        <div className="bg-[#F5A623]/15 rounded-lg p-3">
          <p className="text-[#F5A623] text-xs font-semibold">Plan Gratuit</p>
          <p className="text-white/50 text-xs mt-0.5">2 événements / mois</p>
        </div>
      </div>
    </aside>
  );
}
