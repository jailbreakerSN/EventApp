"use client";

/**
 * Admin shell — root layout of the `(admin)` route group.
 *
 * Wraps every /admin/* page with:
 *   - Auth gate (→ /login if not authenticated)
 *   - Admin-role gate (super_admin OR any platform:* role via useAdminRole)
 *   - Persistent AdminSidebar (collapsible, localStorage-persisted)
 *   - Top bar with palette trigger + role pill + identity
 *   - Global ⌘K / Ctrl+K → admin CommandPalette
 *   - ImpersonationBanner (renders when the session is an impersonation)
 *
 * CRITICAL ARCHITECTURAL NOTE:
 * This layout is the ROOT shell for /admin/*. Prior to the UI-1 split
 * (`refactor(shell): split admin into dedicated (admin) route group`),
 * /admin/* was nested inside `(dashboard)/layout.tsx`, which produced
 * two stacked shells — two sidebars, two topbars, two command palettes.
 * Do NOT re-nest this tree under `(dashboard)/` or the symptom returns.
 *
 * Because the organizer shell no longer wraps us, this layout is
 * responsible for:
 *  - redirecting unauthenticated visitors to /login (previously handled
 *    by (dashboard)/layout.tsx),
 *  - rendering the ImpersonationBanner (same reason),
 *  - owning the full viewport height (no outer 4rem topbar anymore).
 *
 * Super-admins are exempted from the email-verification hard-gate per
 * CLAUDE.md §H6 — operational necessity. No banner is rendered here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Eye, LogOut } from "lucide-react";
import { Badge } from "@teranga/shared-ui";
import { useAuth } from "@/hooks/use-auth";
import { useAdminRole } from "@/hooks/use-admin-role";
import { BrandedLoader } from "@/components/branded-loader";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { CommandPalette } from "@/components/admin/command-palette";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const adminRole = useAdminRole();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const identityRef = useRef<HTMLDivElement>(null);

  // Auth + admin role gate — ran once the session resolves.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!adminRole) {
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

  // Close the identity dropdown when clicking outside or pressing Escape.
  useEffect(() => {
    if (!identityOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (identityRef.current && !identityRef.current.contains(e.target as Node)) {
        setIdentityOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIdentityOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [identityOpen]);

  if (loading) return <BrandedLoader label="Chargement de l'administration..." />;
  if (!user || !adminRole) return null;

  const roleLabel = adminRole.label;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Skip-to-content link for keyboard users — parity with organizer shell. */}
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Aller au contenu principal
      </a>

      {/* Impersonation banner — stays at the very top so the entire shell
          gets pushed down when a super-admin is acting as another user.
          In the current model, impersonating logs the admin OUT of the
          admin session and into the target's participant session, so in
          practice this banner renders in the organizer shell. We still
          mount it here defensively for future flows where an admin may
          launch inline QA while keeping their admin session. */}
      <ImpersonationBanner />

      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top bar with palette trigger + role pill + identity */}
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

            <div className="relative flex items-center gap-3" ref={identityRef}>
              <Badge variant="outline" className="text-[10px]">
                {roleLabel}
              </Badge>
              <button
                type="button"
                onClick={() => setIdentityOpen((prev) => !prev)}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-haspopup="menu"
                aria-expanded={identityOpen}
                aria-label="Ouvrir le menu utilisateur"
              >
                <span className="max-w-[160px] truncate">{user.displayName ?? user.email}</span>
                <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
              </button>
              {identityOpen && (
                <div
                  role="menu"
                  aria-label="Menu utilisateur administration"
                  className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-border bg-background shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIdentityOpen(false);
                      router.push("/dashboard");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
                  >
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    Voir comme organisateur
                  </button>
                  <div className="border-t border-border" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIdentityOpen(false);
                      void logout();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
                  >
                    <LogOut className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    Se déconnecter
                  </button>
                </div>
              )}
            </div>
          </header>

          {/* Scrollable content area */}
          <main id="admin-main" className="flex-1 overflow-y-auto" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
