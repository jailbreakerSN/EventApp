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
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { ChevronDown, Eye, LogOut } from "lucide-react";
import { Badge, ThemeToggle } from "@teranga/shared-ui";
import { useAuth } from "@/hooks/use-auth";
import { useAdminRole } from "@/hooks/use-admin-role";
import { BrandedLoader } from "@/components/branded-loader";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { CommandPalette } from "@/components/admin/command-palette";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { LanguageSwitcher } from "@/components/language-switcher";
import { canViewOrganizerShell } from "@/lib/access";
import type { UserRole } from "@teranga/shared-types";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin.shell");
  const { user, loading, logout } = useAuth();
  const adminRole = useAdminRole();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const identityRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
  // Also move focus INTO the menu on open (WAI-ARIA menu pattern) and
  // return focus to the trigger on close for keyboard-only callers.
  useEffect(() => {
    if (!identityOpen) return;
    // Focus the first menuitem after the portal is rendered.
    const focusId = requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
      first?.focus();
    });
    const onClickOutside = (e: MouseEvent) => {
      if (identityRef.current && !identityRef.current.contains(e.target as Node)) {
        setIdentityOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIdentityOpen(false);
        triggerRef.current?.focus();
        return;
      }
      // Arrow-key traversal within the menu — loop on ends.
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") {
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = items.findIndex((item) => item === active);
      e.preventDefault();
      let next = idx;
      if (e.key === "ArrowDown") next = idx < 0 ? 0 : (idx + 1) % items.length;
      if (e.key === "ArrowUp")
        next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = items.length - 1;
      items[next]?.focus();
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(focusId);
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [identityOpen]);

  if (loading) return <BrandedLoader label={t("loading")} />;
  if (!user || !adminRole) return null;

  const roleLabel = adminRole.label;
  // Show "Voir comme organisateur" only when the user actually has a
  // reason to land on /dashboard — i.e. they hold an organizer /
  // co_organizer / venue_manager role on top of their admin role.
  // A pure platform:finance admin would otherwise land on an empty
  // organizer sidebar, a UX dead-end flagged by review #3.
  const showOrganizerView = canViewOrganizerShell(user.roles as UserRole[]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Skip-to-content link for keyboard users — parity with organizer shell. */}
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        {t("skipToContent")}
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
                aria-label={t("paletteAria")}
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
                {t("paletteHint")}
                <kbd className="ml-2 rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">
                  ⌘K
                </kbd>
              </button>
            </div>

            <div className="relative flex items-center gap-3" ref={identityRef}>
              {/* Shell-level controls — parity with the organizer topbar
                  (see components/layouts/topbar.tsx) so operators do not
                  lose theme / locale preferences when crossing between
                  shells. Notifications bell is deliberately omitted here:
                  admin notifications live under /admin/notifications with
                  their own dedicated surface. */}
              <LanguageSwitcher />
              <ThemeToggle theme={theme} setTheme={setTheme} />
              <Badge variant="outline" className="text-[10px]">
                {roleLabel}
              </Badge>
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setIdentityOpen((prev) => !prev)}
                className="flex min-h-[44px] items-center gap-1 rounded-md px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-haspopup="menu"
                aria-expanded={identityOpen}
                aria-controls="admin-identity-menu"
                aria-label={t("identityMenu")}
              >
                <span className="max-w-[160px] truncate">{user.displayName ?? user.email}</span>
                <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
              </button>
              {identityOpen && (
                <div
                  id="admin-identity-menu"
                  role="menu"
                  aria-orientation="vertical"
                  aria-label={t("identityMenuLabel")}
                  ref={menuRef}
                  className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-md border border-border bg-background shadow-lg"
                >
                  {showOrganizerView && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIdentityOpen(false);
                          router.push("/dashboard");
                        }}
                        className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      >
                        <Eye className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        {t("viewAsOrganizer")}
                      </button>
                      <div className="border-t border-border" />
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIdentityOpen(false);
                      void logout();
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <LogOut className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {t("signOut")}
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
