"use client";

/**
 * Phase 1 — Admin shell layout.
 *
 * Wraps every /admin/* page with:
 *   - Persistent sidebar (AdminSidebar, collapsible, persisted in localStorage)
 *   - Top bar with active admin identity + effective role pill
 *   - Global ⌘K / Ctrl+K keyboard shortcut → CommandPalette
 *   - Admin-role permission gate (super_admin OR any platform:* role)
 *
 * Design notes:
 * - The gate delegates to `useAdminRole()` which is the single source of
 *   truth for "is this caller an admin?". It accepts both the legacy
 *   `super_admin` role and the granular `platform:*` roles introduced
 *   in closure C. Without this the `platform:*` taxonomy would be
 *   dead-code — redirected to /unauthorized before reaching any page.
 * - The shell is flex-based (sidebar + content) so content stretches to
 *   fill available width and scrolls independently of the sidebar.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@teranga/shared-ui";
import { useAuth } from "@/hooks/use-auth";
import { useAdminRole } from "@/hooks/use-admin-role";
import { BrandedLoader } from "@/components/branded-loader";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { CommandPalette } from "@/components/admin/command-palette";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const adminRole = useAdminRole();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Permission gate — accept super_admin AND every platform:* role.
  // `useAdminRole()` returns null when the caller holds none of them.
  useEffect(() => {
    if (loading) return;
    if (!user || !adminRole) {
      router.replace("/unauthorized");
    }
  }, [user, loading, adminRole, router]);

  // ⌘K / Ctrl+K — open palette.
  const onKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (loading) return <BrandedLoader label="Chargement de l'administration..." />;
  if (!user || !adminRole) return null;

  // Display the effective admin role via the Phase E hook so platform:*
  // roles introduced in closure C show up as proper labels.
  const roleLabel = adminRole.label;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      <AdminSidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar with identity + role pill + search shortcut hint */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Ouvrir la palette de commandes"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              Rechercher · saisir, event, lieu…
              <kbd className="ml-2 rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-[10px]">
              {roleLabel}
            </Badge>
            <span className="text-xs text-muted-foreground" aria-label="Utilisateur actif">
              {user.displayName ?? user.email}
            </span>
          </div>
        </header>

        {/* Scrollable content area */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
