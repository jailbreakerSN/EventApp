"use client";

/**
 * Phase 4 — Client helper for super-admin impersonation.
 *
 * Responsibilities:
 *   - Ask the backend to mint a custom token (`adminApi.impersonate()`)
 *   - Sign the current super-admin session out so there's no residual
 *     state in the auth context (prevents cross-session leaks).
 *   - Exchange the custom token via `signInWithCustomToken()` which
 *     stamps the target's claims + the `impersonatedBy: <adminUid>`
 *     claim onto the new ID token.
 *   - Persist a minimal breadcrumb in sessionStorage so the persistent
 *     banner knows we're in an impersonation session and the original
 *     admin uid is retrievable for the "Quitter" action.
 *
 * The banner (<ImpersonationBanner>) consumes this state via a
 * dedicated hook (`useImpersonationState`) and displays across every
 * page until the admin explicitly exits the session.
 *
 * Exit path:
 *   - endImpersonation() signs-out + redirects to /admin/inbox.
 *     The operator has to manually re-login with their admin creds.
 *     That deliberate friction protects against "I forgot I was
 *     impersonating" accidents.
 */

import { signOut, signInWithCustomToken } from "firebase/auth";
import { useEffect, useState } from "react";
import { firebaseAuth } from "@/lib/firebase";
import { adminApi } from "@/lib/api-client";

const STORAGE_KEY = "teranga:impersonation:breadcrumb";

export interface ImpersonationBreadcrumb {
  /** The UID of the super-admin who initiated the session. */
  actorUid: string;
  actorDisplayName: string | null;
  /** The target user now "signed-in". */
  targetUid: string;
  targetDisplayName: string | null;
  targetEmail: string | null;
  /** ISO string; banner hides itself once this is in the past. */
  expiresAt: string;
}

function readBreadcrumb(): ImpersonationBreadcrumb | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationBreadcrumb;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeBreadcrumb(crumb: ImpersonationBreadcrumb): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(crumb));
  } catch {
    /* ignore quota exceptions */
  }
}

function clearBreadcrumb(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Hook exposing the active impersonation breadcrumb (null when not impersonating). */
export function useImpersonationState(): ImpersonationBreadcrumb | null {
  const [state, setState] = useState<ImpersonationBreadcrumb | null>(null);

  useEffect(() => {
    setState(readBreadcrumb());
    const id = setInterval(() => {
      // Auto-expire the breadcrumb on deadline.
      setState(readBreadcrumb());
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  return state;
}

/** Action: start an impersonation session on behalf of target uid. */
export async function startImpersonation(params: {
  actorUid: string;
  actorDisplayName: string | null;
  targetUid: string;
}): Promise<void> {
  const res = await adminApi.impersonate(params.targetUid);
  const { customToken, targetUid, targetDisplayName, targetEmail, expiresAt } = res.data;

  // Sign the current session out FIRST so the ID token refresh on
  // exchange doesn't race with the stale admin token.
  await signOut(firebaseAuth);
  await signInWithCustomToken(firebaseAuth, customToken);

  writeBreadcrumb({
    actorUid: params.actorUid,
    actorDisplayName: params.actorDisplayName,
    targetUid,
    targetDisplayName,
    targetEmail,
    expiresAt,
  });

  // Hard reload so every tab rebuilds against the impersonated session.
  if (typeof window !== "undefined") {
    window.location.assign("/dashboard");
  }
}

/** Action: leave the impersonation session and require admin re-login. */
export async function endImpersonation(): Promise<void> {
  const crumb = readBreadcrumb();
  // Best-effort server-side revoke before local signOut. If the server
  // call fails (network, 401), we still clear local state so the admin
  // isn't stuck in an impersonation session UI-wise. Security model
  // accepts the risk because the impersonation token has a 30-min cap
  // already; server revoke makes stealing a captured token harder.
  if (crumb) {
    try {
      await adminApi.endImpersonation(crumb.actorUid);
    } catch {
      /* swallow — signOut below is the last line of defence */
    }
  }
  clearBreadcrumb();
  await signOut(firebaseAuth);
  if (typeof window !== "undefined") {
    window.location.assign("/login?reason=impersonation-ended");
  }
}

/** The key is exported so parallel clients (mobile, e2e tests) can clear it. */
export const IMPERSONATION_STORAGE_KEY = STORAGE_KEY;
