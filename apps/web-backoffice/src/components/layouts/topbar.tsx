"use client";

import { useAuth } from "@/hooks/use-auth";
import { Bell, LogOut } from "lucide-react";
import type { UserRole } from "@teranga/shared-types";

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "bg-purple-100 text-purple-700" },
  organizer: { label: "Organisateur", color: "bg-green-100 text-green-700" },
  co_organizer: { label: "Co-organisateur", color: "bg-blue-100 text-blue-700" },
  staff: { label: "Staff", color: "bg-orange-100 text-orange-700" },
  participant: { label: "Participant", color: "bg-gray-100 text-gray-600" },
};

export function TopBar() {
  const { user, logout } = useAuth();

  const primaryRole = user?.roles?.[0] ?? "participant";
  const roleInfo = ROLE_LABELS[primaryRole] ?? ROLE_LABELS.participant;

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <div />
      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors" aria-label="Notifications">
          <Bell size={18} className="text-gray-600" />
        </button>

        <div className="flex items-center gap-2">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName ?? ""}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[#1A1A2E] flex items-center justify-center">
              <span className="text-white text-xs font-bold">
                {user?.displayName?.[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
          )}
          <div className="hidden md:flex flex-col">
            <span className="text-sm text-gray-700 font-medium leading-tight">
              {user?.displayName}
            </span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-fit ${roleInfo.color}`}>
              {roleInfo.label}
            </span>
          </div>
        </div>

        <button
          onClick={() => logout()}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          title="Déconnexion"
          aria-label="Déconnexion"
        >
          <LogOut size={17} className="text-gray-500" />
        </button>
      </div>
    </header>
  );
}
