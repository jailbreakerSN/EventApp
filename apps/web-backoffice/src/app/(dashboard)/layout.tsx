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
import { useAuth } from "@/hooks/use-auth";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

const BACKOFFICE_ROLES = ["organizer", "co_organizer", "super_admin", "venue_manager"] as const;

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
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

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
    }
  }, [user, loading, hasRole, router]);

  if (loading) {
    return <BrandedLoader label="Chargement du tableau de bord..." />;
  }

  if (!user || !hasRole(...BACKOFFICE_ROLES)) return null;

  return <DashboardShell>{children}</DashboardShell>;
}
