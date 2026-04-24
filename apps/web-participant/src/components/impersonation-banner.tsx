"use client";

/**
 * Impersonation banner — participant-app target side.
 *
 * Mounted in the authenticated layout. Renders ONLY when the current
 * Firebase ID token carries the server-signed `impersonatedBy` custom
 * claim (stamped by `createCustomToken` at exchange time). The claim
 * cannot be forged by the user — Firebase signs the token with the
 * project's signing key.
 *
 * When visible, the banner:
 *   - Shows which admin opened the session + the deadline.
 *   - Counts down to the 30-minute expiry in real time.
 *   - Provides a "Quitter" button that server-revokes the refresh
 *     tokens, signs out, and closes the tab (or falls back to the
 *     home page if `window.close` is blocked).
 *
 * Why not hide the banner when the tab wasn't opened via
 * `window.open`? Because a leaked accept URL could still end up in
 * the target user's hands — the banner is the last-line warning that
 * keeps the operator honest. The claim is the source of truth.
 */

import { useEffect, useState } from "react";
import { signOut, onIdTokenChanged } from "firebase/auth";
import { AlertTriangle, LogOut } from "lucide-react";
import { firebaseAuth } from "@/lib/firebase";
import { api } from "@/lib/api-client";

interface Session {
  actorUid: string;
  targetUid: string;
  targetLabel: string;
  expiresAt: string;
}

async function readSession(): Promise<Session | null> {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  let tokenResult;
  try {
    tokenResult = await user.getIdTokenResult();
  } catch {
    return null;
  }
  const actor = tokenResult.claims.impersonatedBy;
  const expiresAt = tokenResult.claims.impersonationExpiresAt;
  if (typeof actor !== "string" || typeof expiresAt !== "string") return null;
  if (new Date(expiresAt).getTime() < Date.now()) return null;
  return {
    actorUid: actor,
    targetUid: user.uid,
    targetLabel: user.displayName ?? user.email ?? user.uid,
    expiresAt,
  };
}

function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expirée";
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

async function endImpersonation(session: Session): Promise<void> {
  try {
    await api.post("/v1/admin/impersonation/end", { actorUid: session.actorUid });
  } catch {
    /* best-effort — local signOut is the last line of defence */
  }
  await signOut(firebaseAuth);
  if (typeof window === "undefined") return;
  window.close();
  if (!window.closed) {
    window.location.assign("/");
  }
}

export function ImpersonationBanner() {
  const [session, setSession] = useState<Session | null>(null);
  const [remaining, setRemaining] = useState<string>("");

  // Listen for token changes so sign-out / end-of-session collapses the
  // banner without a reload. Poll every 10 s as a safety net for
  // deadline transitions that don't trigger a token change.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await readSession();
      if (!cancelled) setSession(next);
    };
    void refresh();
    const unsub = onIdTokenChanged(firebaseAuth, () => void refresh());
    const id = setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const tick = () => setRemaining(formatRemaining(session.expiresAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 border-b border-amber-400 bg-amber-100/90 text-amber-950 shadow-sm backdrop-blur dark:border-amber-700 dark:bg-amber-950/80 dark:text-amber-100"
    >
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="font-semibold">Session d&apos;impersonation active</span>
          <span className="hidden sm:inline-block">
            —{" "}
            <span className="font-medium">
              Vous êtes connecté·e en tant que <strong>{session.targetLabel}</strong>
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-amber-800 dark:text-amber-300">
            Expire dans : {remaining}
          </span>
          <button
            type="button"
            onClick={() => void endImpersonation(session)}
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
