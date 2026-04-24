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

import { signOut, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { firebaseAuth } from "@/lib/firebase";
import { adminApi } from "@/lib/api-client";

const STORAGE_KEY = "teranga:impersonation:breadcrumb";

// Roles that belong to the backoffice (organizer / venue / admin shells).
// Any other role class — most notably `participant` + `speaker` +
// `sponsor` + `staff` — must land on the PARTICIPANT web app after
// impersonation, because they have no home in the backoffice and
// `(dashboard)/layout.tsx` redirects them to /unauthorized on entry.
// Kept local (not imported from `@/lib/access`) to avoid pulling a
// Next-only dependency into a hook that runs before the session
// context mounts.
const BACKOFFICE_ROLE_SET = new Set<string>([
  "organizer",
  "co_organizer",
  "venue_manager",
  "super_admin",
  "platform:super_admin",
  "platform:support",
  "platform:finance",
  "platform:ops",
  "platform:security",
]);

// Resolved from `NEXT_PUBLIC_PARTICIPANT_URL` at build time. Set in the
// staging deploy workflow; defaults to "/" locally so `npm run dev`
// doesn't blow up. When absent the post-impersonation redirect falls
// back to reloading the current origin — the user sees whatever the
// participant webapp at that origin renders (typically the public
// landing page, which works for all locally-reachable seeds).
const PARTICIPANT_URL = process.env.NEXT_PUBLIC_PARTICIPANT_URL ?? "";

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
    // Reconcile the breadcrumb against the current Firebase auth user.
    // sessionStorage survives tab reloads and manual logout + re-login
    // by another user — when that happens, the stored `targetUid` no
    // longer matches the active session and the banner would otherwise
    // keep telling the admin they are impersonating when they are not.
    // Clear the stale breadcrumb on mismatch (or on sign-out) so every
    // session-identity transition naturally drops the banner.
    const reconcile = () => {
      const crumb = readBreadcrumb();
      if (!crumb) {
        setState(null);
        return;
      }
      const currentUid = firebaseAuth.currentUser?.uid ?? null;
      if (currentUid && currentUid !== crumb.targetUid) {
        // Auth user is someone else (admin re-login, or identity swap)
        // — the breadcrumb refers to a session that no longer exists.
        clearBreadcrumb();
        setState(null);
        return;
      }
      setState(crumb);
    };

    reconcile();
    // Drive reconcile() from every auth state change so the banner
    // disappears the instant the admin signs back in.
    const unsub = onAuthStateChanged(firebaseAuth, () => reconcile());
    // Keep the interval as a safety net for the expiry deadline
    // (auth state doesn't change when the token just runs out).
    const id = setInterval(reconcile, 15_000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  return state;
}

/**
 * Resolve the post-impersonation landing URL based on the roles stamped
 * on the freshly-minted token. Participants / speakers / sponsors land
 * on the PARTICIPANT web app (nothing useful for them in the backoffice);
 * organizers / venue managers / super-admins land on the backoffice
 * `/dashboard`. Pure admin targets are already blocked server-side
 * (`AdminService.startImpersonation` refuses top-tier admin targets).
 *
 * When `NEXT_PUBLIC_PARTICIPANT_URL` is not configured (local dev), we
 * fall back to the backoffice `/dashboard` — the organizer shell will
 * catch non-backoffice roles via the `(dashboard)/layout.tsx` gate
 * and redirect to `/unauthorized` with a clear message, which is
 * strictly better than a blank page.
 */
function resolveTargetLandingUrl(targetRoles: readonly string[]): string {
  const hasBackofficeRole = targetRoles.some((r) => BACKOFFICE_ROLE_SET.has(r));
  if (hasBackofficeRole) return "/dashboard";
  if (PARTICIPANT_URL) return PARTICIPANT_URL;
  return "/dashboard";
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
  const cred = await signInWithCustomToken(firebaseAuth, customToken);

  // Read the roles stamped on the freshly-minted token so we can route
  // the admin to the right app. The custom token baked `roles:
  // targetProfile.roles` into the payload (see
  // AdminService.startImpersonation); one getIdTokenResult() call
  // surfaces them without a Firestore round-trip.
  let targetRoles: string[] = [];
  try {
    const tokenResult = await cred.user.getIdTokenResult();
    const raw = tokenResult.claims.roles;
    if (Array.isArray(raw)) targetRoles = raw.map(String);
  } catch {
    // Fall-through: resolver treats an empty role list as participant
    // and routes to the participant app. Conservative default.
  }

  writeBreadcrumb({
    actorUid: params.actorUid,
    actorDisplayName: params.actorDisplayName,
    targetUid,
    targetDisplayName,
    targetEmail,
    expiresAt,
  });

  // Hard reload so every tab rebuilds against the impersonated session.
  // Route based on the target's roles — a participant lands on the
  // participant webapp, an organizer on the backoffice, etc.
  if (typeof window !== "undefined") {
    window.location.assign(resolveTargetLandingUrl(targetRoles));
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
