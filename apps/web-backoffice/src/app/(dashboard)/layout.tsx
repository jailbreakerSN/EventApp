"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layouts/sidebar";
import { TopBar } from "@/components/layouts/topbar";
import { SidebarProvider } from "@/components/layouts/sidebar-context";
import { BrandedLoader } from "@/components/branded-loader";
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
    return <BrandedLoader label="Chargement du tableau de bord..." />;
  }

  if (!user || !hasRole(...BACKOFFICE_ROLES)) return null;

  return (
    <SidebarProvider>
      {/* Skip to content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Aller au contenu principal
      </a>

      <div className="flex h-screen bg-muted overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <main id="main-content" className="flex-1 overflow-y-auto p-4 sm:p-6" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
