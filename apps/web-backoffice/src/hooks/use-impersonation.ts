"use client";

/**
 * OAuth-style impersonation — admin-tab actions + claims-based session
 * detection for the target-tab banner.
 *
 * Two responsibilities:
 *
 *   1. `startImpersonation(...)` — the admin-tab action. POSTs to
 *      `/v1/admin/users/:uid/impersonate` to get back an opaque code +
 *      absolute accept URL; opens the accept URL in a NEW tab with
 *      `noopener,noreferrer`. The admin's own session on this tab
 *      stays untouched.
 *
 *   2. `useImpersonationSession()` — the target-tab hook. Reads the
 *      current Firebase ID token's `impersonatedBy` / `impersonation-
 *      ExpiresAt` custom claims (server-signed by `createCustomToken`)
 *      to detect whether THIS tab is running an impersonated session.
 *      The banner component consumes this. Claim-based detection is
 *      safer than sessionStorage: the claim is HMAC-signed by
 *      Firebase, cannot be forged by the user, and naturally expires
 *      when the session ends.
 *
 *   3. `endImpersonation()` — the "Quitter" action invoked from the
 *      target-tab banner. Calls `/v1/admin/impersonation/end` (which
 *      validates the signed `impersonatedBy` claim server-side and
 *      revokes the impersonated refresh tokens), signs the target
 *      session out, and attempts to close the tab. If `window.close`
 *      is blocked (tab wasn't opened via `window.open`), falls back
 *      to `/login?reason=impersonation-ended`.
 *
 * See `packages/shared-types/src/impersonation.types.ts` for the full
 * security rationale of the auth-code flow.
 */

import { signOut, onIdTokenChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { firebaseAuth } from "@/lib/firebase";
import { adminApi } from "@/lib/api-client";

// ─── Admin-tab action ────────────────────────────────────────────────────────

export async function startImpersonation(params: { targetUid: string }): Promise<{
  code: string;
  acceptUrl: string;
  targetOrigin: string;
  expiresAt: string;
  targetUid: string;
  targetDisplayName: string | null;
  targetEmail: string | null;
  targetRoles: string[];
}> {
  const res = await adminApi.impersonate(params.targetUid);
  const data = res.data;

  if (typeof window !== "undefined") {
    // New tab + strongest privacy flags. `noopener` severs the
    // window.opener reference so the target tab cannot script-access
    // the admin tab (tab-nabbing). `noreferrer` strips the Referer
    // header on the initial navigation (defence-in-depth against
    // logging the admin URL in the target app's analytics).
    window.open(data.acceptUrl, "_blank", "noopener,noreferrer");
  }

  return data;
}

// ─── Target-tab: claims-based session state ──────────────────────────────────

export interface ImpersonationSession {
  /** The admin who opened the session, extracted from the claims. */
  actorUid: string;
  /**
   * The currently signed-in target uid — the `uid` field of the
   * decoded token. Lets the banner render "connecté·e en tant que X"
   * without a profile round-trip (combined with displayName).
   */
  targetUid: string;
  targetDisplayName: string | null;
  targetEmail: string | null;
  /** ISO deadline stamped by the server on the custom token. */
  expiresAt: string;
}

async function readClaimsSession(): Promise<ImpersonationSession | null> {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  let tokenResult;
  try {
    // Non-forcing read — the SDK refreshes when the token is close to
    // expiry, which is enough for banner accuracy. A forced refresh on
    // every poll would hit the token endpoint repeatedly.
    tokenResult = await user.getIdTokenResult();
  } catch {
    return null;
  }
  const actor = tokenResult.claims.impersonatedBy;
  const expiresAt = tokenResult.claims.impersonationExpiresAt;
  if (typeof actor !== "string" || typeof expiresAt !== "string") {
    return null;
  }
  if (new Date(expiresAt).getTime() < Date.now()) {
    return null;
  }
  return {
    actorUid: actor,
    targetUid: user.uid,
    targetDisplayName: user.displayName,
    targetEmail: user.email,
    expiresAt,
  };
}

export function useImpersonationSession(): ImpersonationSession | null {
  const [state, setState] = useState<ImpersonationSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await readClaimsSession();
      if (!cancelled) setState(next);
    };
    void refresh();
    // onIdTokenChanged fires on sign-in / sign-out / token refresh,
    // which covers the full lifecycle of an impersonation session
    // without polling.
    const unsub = onIdTokenChanged(firebaseAuth, () => void refresh());
    // 10-second safety-net poll for the banner countdown: the token
    // itself is good for an hour, but the impersonation claim carries
    // its own deadline inside that hour, and the banner copy must
    // drop to "expirée" the moment it passes.
    const id = setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(id);
    };
  }, []);

  return state;
}

// ─── Target-tab: end-session action ──────────────────────────────────────────

export async function endImpersonation(): Promise<void> {
  const user = firebaseAuth.currentUser;
  let actorUid: string | null = null;
  if (user) {
    try {
      const tokenResult = await user.getIdTokenResult();
      actorUid =
        typeof tokenResult.claims.impersonatedBy === "string"
          ? tokenResult.claims.impersonatedBy
          : null;
    } catch {
      /* best-effort — fall back to cleanup below */
    }
  }

  if (actorUid) {
    // Server revoke — validates the signed `impersonatedBy` claim
    // and drops the impersonated refresh tokens. Swallow errors: the
    // local signOut below is the last line of defence.
    try {
      await adminApi.endImpersonation(actorUid);
    } catch {
      /* noop */
    }
  }

  await signOut(firebaseAuth);

  if (typeof window === "undefined") return;
  // Tab was opened via `window.open` → closing it is the best UX.
  // If the admin navigated here manually the close call is a no-op
  // in modern browsers, so we fall back to a sign-in redirect.
  window.close();
  if (!window.closed) {
    window.location.assign("/login?reason=impersonation-ended");
  }
}
