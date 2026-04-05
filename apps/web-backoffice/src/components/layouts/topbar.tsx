"use client";

import { useAuth } from "@/hooks/use-auth";
import { Bell, LogOut } from "lucide-react";

export function TopBar() {
  const { user, logout } = useAuth();

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <div />
      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
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
          <span className="text-sm text-gray-700 font-medium hidden md:block">
            {user?.displayName}
          </span>
        </div>

        <button
          onClick={() => logout()}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          title="Déconnexion"
        >
          <LogOut size={17} className="text-gray-500" />
        </button>
      </div>
    </header>
  );
}
