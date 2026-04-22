"use client";

import { useCallback, useEffect, useState } from "react";
import { getToken } from "firebase/messaging";
import { getFirebaseMessaging } from "@/lib/firebase";
import { meApi, ApiError } from "@/lib/api-client";
import { fingerprintToken } from "@/lib/fingerprint-token";

// ─── useWebPushRegistration (Phase C.2) ─────────────────────────────────────
// Progressively-enhanced Web Push onboarding. Owns the browser-side
// lifecycle:
//   1. Read Notification.permission (or surface "unsupported" for iOS Safari
//      pre-16.4, Firefox incognito, and WebView contexts where the API is
//      missing entirely).
//   2. On user opt-in, register /firebase-messaging-sw.js with the Firebase
//      config baked into the register URL (apiKey / projectId / …), fetch
//      an FCM token via getToken(), and POST it to /v1/me/fcm-tokens.
//   3. Persist the 16-char fingerprint in localStorage so subsequent mounts
//      know "this browser is already registered" without re-prompting.
//   4. Offer revoke() (single-fingerprint) + revokeAll() (sign-out path) so
//      the user doc never carries a stale token after explicit opt-out.
//
// Never retry on 429 — the POST endpoint caps at 20/hour/user and a
// permission-flip loop is the only realistic way to hit that ceiling.
// Surfacing "try again later" is the correct UX.
//
// localStorage key — keep in sync with the web-participant copy so a user
// who switches browsers / devices doesn't see stale UI. The value is a
// plain fingerprint string; if the shape needs to change add a versioned
// wrapper rather than overloading this key.

const FINGERPRINT_STORAGE_KEY = "teranga.push.fingerprint";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export type RegisterResult =
  | { ok: true; fingerprint: string; status: "registered" | "refreshed" }
  | { ok: false; reason: "permission_denied" | "unsupported" | "rate_limited" | "error" };

export interface UseWebPushRegistration {
  permission: PushPermission;
  isRegistering: boolean;
  registeredFingerprint: string | null;
  register: () => Promise<RegisterResult>;
  revoke: () => Promise<void>;
  revokeAll: () => Promise<void>;
}

function readStoredFingerprint(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(FINGERPRINT_STORAGE_KEY);
  } catch {
    // Private-mode Safari throws on localStorage access — treat as unset.
    return null;
  }
}

function writeStoredFingerprint(fp: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (fp === null) window.localStorage.removeItem(FINGERPRINT_STORAGE_KEY);
    else window.localStorage.setItem(FINGERPRINT_STORAGE_KEY, fp);
  } catch {
    // Same Safari-private-mode case. A failed write just means the next
    // mount will re-prompt; preferable to crashing the caller.
  }
}

function readPermission(): PushPermission {
  if (typeof window === "undefined") return "unsupported";
  // iOS Safari < 16.4 lacks Notification entirely; older Firefox incognito
  // stubs it to undefined. Both paths need to render an "unsupported" CTA
  // rather than crashing with a ReferenceError.
  if (typeof Notification === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission;
}

// Build the Service Worker registration URL with the Firebase config baked
// in via query string — Next.js doesn't transform files in public/, so the
// SW reads its config from location.search at install time. Keeps the SW
// file immutable across deploy envs (no placeholder substitution step).
function buildSwUrl(): string {
  const params = new URLSearchParams({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export function useWebPushRegistration(): UseWebPushRegistration {
  const [permission, setPermission] = useState<PushPermission>("unsupported");
  const [isRegistering, setIsRegistering] = useState(false);
  const [registeredFingerprint, setRegisteredFingerprint] = useState<string | null>(null);

  useEffect(() => {
    setPermission(readPermission());
    setRegisteredFingerprint(readStoredFingerprint());
  }, []);

  const register = useCallback(async (): Promise<RegisterResult> => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return { ok: false, reason: "unsupported" };
    }
    if (!("serviceWorker" in navigator)) {
      return { ok: false, reason: "unsupported" };
    }

    setIsRegistering(true);
    try {
      // Ask the user if we haven't already — granted/denied short-circuit
      // immediately so repeat mounts don't re-prompt.
      let perm = Notification.permission;
      if (perm === "default") {
        perm = await Notification.requestPermission();
        setPermission(perm);
      }
      if (perm === "denied") {
        return { ok: false, reason: "permission_denied" };
      }
      if (perm !== "granted") {
        // Edge case: some Safari versions return "default" even after prompt.
        return { ok: false, reason: "permission_denied" };
      }

      const messaging = await getFirebaseMessaging();
      if (!messaging) {
        return { ok: false, reason: "unsupported" };
      }

      const swUrl = buildSwUrl();
      const reg = await navigator.serviceWorker.register(swUrl);
      // Ensure the SW is active before we ask FCM to hand it a push
      // subscription — getToken() throws otherwise.
      await navigator.serviceWorker.ready;

      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
        // Misconfigured env — don't pretend we registered. Caller can
        // log this; the banner stays visible so the user can retry once
        // the operator fixes the env.
        return { ok: false, reason: "error" };
      }

      const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: reg,
      });
      if (!token) {
        return { ok: false, reason: "permission_denied" };
      }

      const fp = await fingerprintToken(token);

      try {
        const result = await meApi.registerFcmToken({
          token,
          platform: "web",
          userAgent: navigator.userAgent,
        });
        writeStoredFingerprint(fp);
        setRegisteredFingerprint(fp);
        return {
          ok: true,
          fingerprint: fp,
          status: result.data.status,
        };
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 429) {
          return { ok: false, reason: "rate_limited" };
        }
        return { ok: false, reason: "error" };
      }
    } catch {
      return { ok: false, reason: "error" };
    } finally {
      setIsRegistering(false);
    }
  }, []);

  const revoke = useCallback(async (): Promise<void> => {
    const fp = readStoredFingerprint();
    if (!fp) return;
    try {
      await meApi.revokeFcmToken(fp);
    } catch {
      // Revoke is best-effort — the server dedupes + caps at 10, and a
      // failed revoke eventually evicts itself. Don't block UX on it.
    }
    writeStoredFingerprint(null);
    setRegisteredFingerprint(null);
  }, []);

  const revokeAll = useCallback(async (): Promise<void> => {
    try {
      await meApi.revokeAllFcmTokens();
    } catch {
      // Sign-out path — never block logout on a push revoke failure.
    }
    writeStoredFingerprint(null);
    setRegisteredFingerprint(null);
  }, []);

  return {
    permission,
    isRegistering,
    registeredFingerprint,
    register,
    revoke,
    revokeAll,
  };
}
