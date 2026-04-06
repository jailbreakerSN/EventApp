"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layouts/sidebar";
import { TopBar } from "@/components/layouts/topbar";
import { useAuth } from "@/hooks/use-auth";

const BACKOFFICE_ROLES = ["organizer", "co_organizer", "super_admin"] as const;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, hasRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    // Role gate: only organizers, co-organizers, and super admins can access backoffice
    if (!hasRole(...BACKOFFICE_ROLES)) {
      router.replace("/unauthorized");
    }
  }, [user, loading, hasRole, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-gray-500">Chargement...</div>
      </div>
    );
  }

  if (!user || !hasRole(...BACKOFFICE_ROLES)) return null;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
