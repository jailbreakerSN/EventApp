"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Sidebar } from "@/components/layouts/sidebar";
import { TopBar } from "@/components/layouts/topbar";
import { SidebarProvider } from "@/components/layouts/sidebar-context";
import { BrandedLoader } from "@/components/branded-loader";
import { CommandPalette } from "@/components/command-palette";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { useAuth } from "@/hooks/use-auth";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
// Shared access taxonomy — single source of truth for who may traverse
// the backoffice shell. See apps/web-backoffice/src/lib/access.ts.
// Admin roles (`super_admin`, `platform:*`) are included so a super-
// admin who is ALSO an organizer can navigate to /dashboard manually;
// pure admins are redirected to /admin/inbox at login by resolveLandingRoute.
import { BACKOFFICE_ROLES, ADMIN_ROLES } from "@/lib/access";
import type { UserRole } from "@teranga/shared-types";

// Grace period before the email-verification hard gate kicks in. Configurable
// via NEXT_PUBLIC_EMAIL_GRACE_DAYS; default 7. Set to 0 to gate immediately.
const GRACE_DAYS = Number.parseInt(process.env.NEXT_PUBLIC_EMAIL_GRACE_DAYS ?? "7", 10);
const GRACE_MS =
  Number.isFinite(GRACE_DAYS) && GRACE_DAYS >= 0
    ? GRACE_DAYS * 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;

/**
 * Returns true when an unverified user has exceeded the grace period.
 *
 * Every admin role (super_admin + 5 platform:* subroles) is exempt —
 * platform operators must never be locked out by a verification race
 * (CLAUDE.md §H6). The exemption reads from ADMIN_ROLES in lib/access.ts
 * so adding a new admin subrole automatically inherits the exemption.
 * Before this change the exemption was hardcoded to "super_admin" only,
 * which made a platform:support admin clicking "Voir comme organisateur"
 * end up on /verify-email — the opposite of the intended behaviour.
 */
function shouldHardGateEmail(user: {
  emailVerified: boolean;
  createdAt: string | null;
  roles: readonly string[];
}): boolean {
  if (user.emailVerified) return false;
  if (user.roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r as UserRole))) {
    return false;
  }
  if (!user.createdAt) return false;
  const age = Date.now() - new Date(user.createdAt).getTime();
  return age > GRACE_MS;
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const { user, resendVerification } = useAuth();
  const [sendingVerification, setSendingVerification] = useState(false);

  useKeyboardShortcuts({ onShowHelp: () => setShortcutsOpen(true) });

  const handleResendVerification = async () => {
    setSendingVerification(true);
    try {
      await resendVerification();
      toast.success("Email de vérification envoyé !");
    } catch {
      toast.error("Impossible d'envoyer l'email. Réessayez dans quelques minutes.");
    } finally {
      setSendingVerification(false);
    }
  };

  const showVerificationBanner = user && !user.emailVerified && !bannerDismissed;

  return (
    <SidebarProvider>
      {/* Skip to content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Aller au contenu principal
      </a>

      {/* Command palette — always mounted, opens on Cmd+K / Ctrl+K */}
      <CommandPalette />

      {/* Keyboard shortcuts help dialog — opens on "?" */}
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Phase 4 — Persistent banner whenever a super-admin is acting
          as another user. Renders OUTSIDE the Sidebar/TopBar shell so
          it stays visible regardless of which admin / dashboard page
          the admin is on. */}
      <ImpersonationBanner />

      <div className="flex h-screen bg-muted overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar onShowShortcuts={() => setShortcutsOpen(true)} />
          {showVerificationBanner && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-200"
            >
              <p className="flex-1">
                Votre adresse email n&apos;est pas vérifiée.{" "}
                <button
                  onClick={handleResendVerification}
                  disabled={sendingVerification}
                  className="font-medium underline hover:no-underline disabled:opacity-50"
                >
                  {sendingVerification ? "Envoi..." : "Renvoyer l'email"}
                </button>
              </p>
              <button
                onClick={() => setBannerDismissed(true)}
                className="p-0.5 text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <main id="main-content" className="flex-1 overflow-y-auto p-4 sm:p-6" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

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
      return;
    }

    // Hard email-verification gate once the grace period elapses.
    // NOTE (2026-04-14, security review): the API auth middleware does
    // NOT currently check `email_verified` on the decoded ID token —
    // this client gate is presently the *sole* enforcement layer. A
    // companion PR will add a `requireEmailVerified` middleware in
    // apps/api/src/middlewares/auth.middleware.ts and apply it to
    // every mutating backoffice route. Until that lands, treat this
    // redirect as UX-only and do not rely on it as a security boundary.
    if (shouldHardGateEmail(user)) {
      router.replace("/verify-email");
      return;
    }
  }, [user, loading, hasRole, router]);

  if (loading) {
    return <BrandedLoader label="Chargement du tableau de bord..." />;
  }

  if (!user || !hasRole(...BACKOFFICE_ROLES)) return null;
  if (shouldHardGateEmail(user)) return null;

  return <DashboardShell>{children}</DashboardShell>;
}
