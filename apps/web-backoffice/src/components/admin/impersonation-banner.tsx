"use client";

/**
 * Impersonation banner — target-tab side.
 *
 * Renders at the top of every backoffice page WHEN the current tab's
 * Firebase ID token carries an `impersonatedBy` claim (server-signed
 * by `createCustomToken` at exchange time). Zero configuration needed:
 * the hook detects the session from the token itself, not from
 * sessionStorage.
 *
 * The banner:
 *   - Shows the target user's identity (display name / email / uid).
 *   - Shows a countdown to expiry (30-minute session cap).
 *   - Exposes a "Quitter" button that server-revokes + signs out +
 *     closes the tab (or falls back to /login redirect).
 *
 * Why amber (not red): the operator IS doing something legitimate —
 * the banner is a reminder, not an error. Stripe, Intercom and
 * Salesforce all use the same amber-gold palette for "acting as".
 */

import { useEffect, useState } from "react";
import { AlertTriangle, LogOut } from "lucide-react";
import {
  useImpersonationSession,
  endImpersonation,
  type ImpersonationSession,
} from "@/hooks/use-impersonation";

function formatRemaining(session: ImpersonationSession): string {
  const ms = new Date(session.expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expirée";
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

export function ImpersonationBanner() {
  const session = useImpersonationSession();
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    if (!session) return;
    const update = () => setRemaining(formatRemaining(session));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;

  const targetLabel = session.targetDisplayName ?? session.targetEmail ?? session.targetUid;

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
