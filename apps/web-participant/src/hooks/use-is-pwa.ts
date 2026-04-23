"use client";

import { useEffect, useState } from "react";

// ─── useIsPwa (Phase D.5) ───────────────────────────────────────────────────
// Reports whether the current page is running as a home-screen PWA. Detection
// order, most reliable first:
//
//   1. `window.matchMedia("(display-mode: standalone)")` — modern browsers
//      (Chrome, Edge, Android, macOS Safari 17+).
//   2. `(navigator as unknown as { standalone?: boolean }).standalone === true`
//      — iOS Safari specific. Note: iOS exposes this flag on `Navigator`, not
//      on `window`, which trips up a lot of naive implementations.
//   3. URL `?source=pwa` query — the manifest's `start_url` stamps this so
//      that even if the media query misfires on an iOS quirk, we still know.
//      Once detected we mirror it into sessionStorage, because the query
//      param is stripped on the first client-side navigation.
//
// SSR-safe: returns `null` until the first effect run so server-rendered HTML
// never commits to a boolean that might disagree with the hydrated client
// value. Downstream code should treat `null` as "unknown — show nothing yet".

const PWA_SESSION_KEY = "teranga.isPwa";

function readFromSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PWA_SESSION_KEY) === "true";
  } catch {
    // Private-mode Safari can throw on sessionStorage access.
    return false;
  }
}

function writeToSession(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PWA_SESSION_KEY, value ? "true" : "false");
  } catch {
    // Quota / private-mode — best-effort only.
  }
}

function detectFromEnv(): boolean {
  if (typeof window === "undefined") return false;

  // Desktop + modern mobile browsers expose display-mode via matchMedia.
  if (typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch {
      // Some jsdom / test envs don't implement matchMedia fully — skip.
    }
  }

  // iOS Safari: the flag is on `navigator`, not `window`. TS doesn't have
  // it in the lib.dom types because it's a non-standard Apple extension.
  const navStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
  if (navStandalone === true) return true;

  // Manifest-driven launch: the webmanifest start_url bakes `?source=pwa`
  // so the very first paint of a home-screen launch carries this hint.
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") === "pwa") return true;
  } catch {
    // Malformed URL — impossible in practice, but don't crash.
  }

  return false;
}

export function useIsPwa(): boolean | null {
  // `null` on the server + first client render. The first effect replaces
  // it with a concrete boolean, matching happy-dom / React 19 hydration.
  const [isPwa, setIsPwa] = useState<boolean | null>(null);

  useEffect(() => {
    const sessionHit = readFromSession();
    const envHit = detectFromEnv();
    const resolved = sessionHit || envHit;
    if (envHit && !sessionHit) {
      // First boot of a PWA session — persist so the signal survives
      // client-side navigation that strips the `?source=pwa` param.
      writeToSession(true);
    }
    setIsPwa(resolved);
  }, []);

  return isPwa;
}
