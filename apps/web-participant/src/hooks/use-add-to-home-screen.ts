"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsPwa } from "./use-is-pwa";

// ─── useAddToHomeScreen (Phase D.5) ─────────────────────────────────────────
// Platform-aware "install Teranga to your home screen" helper. Returns every
// signal a caller needs to decide whether (and how) to prompt the user to
// install the PWA — the only precondition iOS 16.4+ enforces before Web Push
// notifications are allowed in Safari.
//
// Why the gates are so strict:
//   - Browser install prompts are single-use and cheap to annoy with, so we
//     require a minimum of 3 visits before the first nudge.
//   - iOS has no programmatic prompt — the only path is an instructional
//     screenshot flow. We still want to respect dismissals like a real
//     prompt would, capping at 3 dismissals with a 7-day cooldown between
//     each (matching the Phase C.2 push banner cadence).
//   - Already-installed users should never see the banner again; `isPwa`
//     flips it off immediately.
//
// Storage keys (all under localStorage, never cleared on sign-out since the
// decision is browser-scoped, not user-scoped):
//   - teranga.visits               — int, incremented once per mount
//   - teranga.a2hs.dismissed       — int, number of dismissals
//   - teranga.a2hs.lastDismissedAt — int (epoch ms), last dismissal
//
// The `trigger()` method is idempotent and platform-dispatched: Android
// Chrome fires the saved `beforeinstallprompt` event and reports its
// outcome; iOS returns "instructed" so the caller shows its own modal.

const VISITS_KEY = "teranga.visits";
const DISMISSED_COUNT_KEY = "teranga.a2hs.dismissed";
const DISMISSED_AT_KEY = "teranga.a2hs.lastDismissedAt";

const MIN_VISITS = 3;
const MAX_DISMISSALS = 3;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days.

// TS doesn't know about BeforeInstallPromptEvent — it's Chrome-specific and
// hasn't been standardised. We keep a minimal typed contract rather than a
// free `any`.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export type AddToHomeScreenReason =
  | "already-pwa"
  | "not-supported"
  | "too-early"
  | "dismissed"
  | "ready";

export interface UseAddToHomeScreen {
  // Platform detection
  isIos: boolean;
  isAndroidChrome: boolean;
  isPwa: boolean | null;
  isDesktop: boolean;

  // State
  canShow: boolean;
  dismissedCount: number;
  visitCount: number;

  // Actions
  trigger: () => Promise<"installed" | "dismissed" | "instructed">;
  dismiss: () => void;
  promptAndroid: () => Promise<void>;

  // For UI copy branching
  reason?: AddToHomeScreenReason;
}

function readInt(key: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeInt(key: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Quota / private-mode — best-effort.
  }
}

// ─── UA heuristics ─────────────────────────────────────────────────────────
// Both iOS + Android checks keep to user-agent sniffing because the Client
// Hints UA API isn't available on iOS Safari (the exact browser we need to
// detect). The UA lookup is confined to this module.

function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports as Macintosh with maxTouchPoints > 1 — standard trick.
  const isIpadOs = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIpadOs;
}

function detectAndroidChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Chrome / Edge / Samsung Internet on Android all expose `beforeinstallprompt`.
  const isAndroid = /Android/i.test(ua);
  const isChromeLike = /Chrome\/|CriOS\/|EdgA\/|SamsungBrowser\//i.test(ua);
  return isAndroid && isChromeLike;
}

function detectDesktop(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  return !mobile;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useAddToHomeScreen(): UseAddToHomeScreen {
  const isPwa = useIsPwa();
  const [isIos, setIsIos] = useState(false);
  const [isAndroidChrome, setIsAndroidChrome] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [visitCount, setVisitCount] = useState(0);
  const [dismissedCount, setDismissedCount] = useState(0);
  const [lastDismissedAt, setLastDismissedAt] = useState(0);
  const promptEventRef = useRef<BeforeInstallPromptEvent | null>(null);

  // One-shot side effect: read platform flags, bump visit count, capture
  // any in-flight beforeinstallprompt on Android Chrome. Runs exactly once
  // per mount so the visit counter can't drift.
  useEffect(() => {
    setIsIos(detectIos());
    setIsAndroidChrome(detectAndroidChrome());
    setIsDesktop(detectDesktop());

    // Bump visit counter (cheap approximation of "user has engaged").
    const next = readInt(VISITS_KEY) + 1;
    writeInt(VISITS_KEY, next);
    setVisitCount(next);

    setDismissedCount(readInt(DISMISSED_COUNT_KEY));
    setLastDismissedAt(readInt(DISMISSED_AT_KEY));

    // Chrome fires `beforeinstallprompt` when the page is installable and
    // the user has spent enough time on the origin. We must preventDefault
    // immediately to keep the event alive for a later `prompt()` call.
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      e.preventDefault();
      promptEventRef.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // ─── Gating ────────────────────────────────────────────────────────────
  // Mirrors the banner contract in the task description. Works off the
  // already-loaded state values so callers see consistent re-renders.

  let reason: AddToHomeScreenReason | undefined;
  let canShow = false;

  if (isPwa === null) {
    // Still hydrating — withhold the banner. `canShow` stays false.
  } else if (isPwa) {
    reason = "already-pwa";
  } else if (!isIos && !isAndroidChrome) {
    // Desktop Chrome does support `beforeinstallprompt`, but the banner is
    // participant-focused (mobile event-goers). Keep it off desktop.
    reason = "not-supported";
  } else if (visitCount < MIN_VISITS) {
    reason = "too-early";
  } else if (dismissedCount >= MAX_DISMISSALS) {
    reason = "dismissed";
  } else if (lastDismissedAt > 0 && Date.now() - lastDismissedAt < COOLDOWN_MS) {
    reason = "dismissed";
  } else {
    reason = "ready";
    canShow = true;
  }

  const dismiss = useCallback(() => {
    const nextCount = readInt(DISMISSED_COUNT_KEY) + 1;
    const now = Date.now();
    writeInt(DISMISSED_COUNT_KEY, nextCount);
    writeInt(DISMISSED_AT_KEY, now);
    setDismissedCount(nextCount);
    setLastDismissedAt(now);
  }, []);

  const promptAndroid = useCallback(async (): Promise<void> => {
    const ev = promptEventRef.current;
    if (!ev) return;
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch {
      // The browser rejects double-calls; swallow and rely on re-render.
    } finally {
      // Chrome only allows one prompt() per event — clear the ref either way.
      promptEventRef.current = null;
    }
  }, []);

  const trigger = useCallback(async (): Promise<"installed" | "dismissed" | "instructed"> => {
    // Android Chrome path — programmatic prompt.
    if (isAndroidChrome && promptEventRef.current) {
      const ev = promptEventRef.current;
      try {
        await ev.prompt();
        const choice = await ev.userChoice;
        promptEventRef.current = null;
        return choice.outcome === "accepted" ? "installed" : "dismissed";
      } catch {
        promptEventRef.current = null;
        return "dismissed";
      }
    }
    // iOS path — we can only surface instructions. Caller renders the
    // step-by-step modal against this return value.
    if (isIos) return "instructed";
    // Fallback: other browsers (desktop, non-Chrome Android) — no install.
    return "dismissed";
  }, [isAndroidChrome, isIos]);

  return {
    isIos,
    isAndroidChrome,
    isPwa,
    isDesktop,
    canShow,
    dismissedCount,
    visitCount,
    trigger,
    dismiss,
    promptAndroid,
    reason,
  };
}
