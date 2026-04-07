"use client";

import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "next-themes";
import { ThemeToggle } from "@teranga/shared-ui";
import { Bell, LogOut, Menu } from "lucide-react";
import { useSidebar } from "./sidebar-context";
import type { UserRole } from "@teranga/shared-types";

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
  organizer: { label: "Organisateur", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  co_organizer: { label: "Co-organisateur", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  staff: { label: "Staff", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  participant: { label: "Participant", color: "bg-accent text-muted-foreground" },
};

export function TopBar() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { isOpen, toggle } = useSidebar();

  const primaryRole = user?.roles?.[0] ?? "participant";
  const roleInfo = ROLE_LABELS[primaryRole] ?? ROLE_LABELS.participant;

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 sm:px-6 shrink-0">
      {/* Left: hamburger on mobile */}
      <div className="flex items-center">
        <button
          onClick={toggle}
          className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-accent motion-safe:transition-colors"
          aria-label={isOpen ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={isOpen}
          aria-controls="mobile-sidebar"
        >
          <Menu size={20} className="text-foreground" aria-hidden="true" />
        </button>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-3">
        <ThemeToggle theme={theme} setTheme={setTheme} />

        <button className="relative p-2 rounded-lg hover:bg-accent motion-safe:transition-colors" aria-label="Notifications">
          <Bell size={18} className="text-muted-foreground" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-2">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName ?? ""}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center" aria-hidden="true">
              <span className="text-white text-xs font-bold">
                {user?.displayName?.[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
          )}
          <div className="hidden md:flex flex-col">
            <span className="text-sm text-foreground font-medium leading-tight">
              {user?.displayName}
            </span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-fit ${roleInfo.color}`}>
              {roleInfo.label}
            </span>
          </div>
        </div>

        <button
          onClick={() => logout()}
          className="p-2 rounded-lg hover:bg-accent motion-safe:transition-colors"
          title="Déconnexion"
          aria-label="Déconnexion"
        >
          <LogOut size={17} className="text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
