"use client";

/**
 * Phase 4 — Persistent impersonation banner.
 *
 * Renders across every dashboard page when the session is flagged as an
 * impersonation (via sessionStorage breadcrumb). Super-admins must see
 * this banner continuously — if they forget they're impersonating, a
 * mutation applied "as the user" could look like user behaviour to
 * downstream observers. The banner:
 *
 *   - Shows the target user's identity (display name + email).
 *   - Shows a countdown to expiration (30 min by default).
 *   - Provides a "Quitter" button that signs-out + redirects to the
 *     login page with a reason flag so onboarding copy can explain.
 *
 * Color choice (amber + red text): stands out without looking like a
 * hard error. Matches the admin-grade SaaS convention (Stripe, Intercom,
 * Salesforce all use amber banners for "acting as another user").
 */

import { useEffect, useState } from "react";
import { AlertTriangle, LogOut } from "lucide-react";
import { useImpersonationState, endImpersonation } from "@/hooks/use-impersonation";

export function ImpersonationBanner() {
  const state = useImpersonationState();
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    if (!state) return;
    const update = () => {
      const ms = new Date(state.expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining("expirée");
        return;
      }
      const mins = Math.floor(ms / 60_000);
      const secs = Math.floor((ms % 60_000) / 1000);
      setRemaining(`${mins}m ${String(secs).padStart(2, "0")}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [state]);

  if (!state) return null;

  const targetLabel = state.targetDisplayName ?? state.targetEmail ?? state.targetUid;

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 border-b border-amber-400 bg-amber-100/90 text-amber-950 shadow-sm backdrop-blur dark:border-amber-700 dark:bg-amber-950/80 dark:text-amber-100"
    >
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="font-semibold">Session d'impersonation active</span>
          <span className="hidden sm:inline-block">
            —{" "}
            <span className="font-medium">
              Vous êtes connecté·e en tant que <strong>{targetLabel}</strong>
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-amber-800 dark:text-amber-300">
            Expire dans : {remaining}
          </span>
          <button
            type="button"
            onClick={() => void endImpersonation()}
            className="inline-flex items-center gap-1 rounded-md bg-amber-900/10 px-2.5 py-1 text-xs font-medium text-amber-950 transition-colors hover:bg-amber-900/20 dark:text-amber-50 dark:hover:bg-amber-50/10"
            aria-label="Quitter la session d'impersonation"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Quitter
          </button>
        </div>
      </div>
    </div>
  );
}
