"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsPwa } from "./use-is-pwa";

// ─── useAddToHomeScreen (Phase D.5) ─────────────────────────────────────────
// Platform-aware "install Teranga to your home screen" helper. Identical to
// the participant copy; kept alongside the backoffice so the two apps stay
// independently deployable. The backoffice does NOT render an install banner
// today (organizers open the console from a laptop bookmark), but the hook
// is available for future organizer-on-the-go features (e.g. check-in
// console on a tablet).

const VISITS_KEY = "teranga.visits";
const DISMISSED_COUNT_KEY = "teranga.a2hs.dismissed";
const DISMISSED_AT_KEY = "teranga.a2hs.lastDismissedAt";

const MIN_VISITS = 3;
const MAX_DISMISSALS = 3;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

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
  isIos: boolean;
  isAndroidChrome: boolean;
  isPwa: boolean | null;
  isDesktop: boolean;
  canShow: boolean;
  dismissedCount: number;
  visitCount: number;
  trigger: () => Promise<"installed" | "dismissed" | "instructed">;
  dismiss: () => void;
  promptAndroid: () => Promise<void>;
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
    // best-effort
  }
}

function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIpadOs = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIpadOs;
}

function detectAndroidChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
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

export function useAddToHomeScreen(): UseAddToHomeScreen {
  const isPwa = useIsPwa();
  const [isIos, setIsIos] = useState(false);
  const [isAndroidChrome, setIsAndroidChrome] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [visitCount, setVisitCount] = useState(0);
  const [dismissedCount, setDismissedCount] = useState(0);
  const [lastDismissedAt, setLastDismissedAt] = useState(0);
  const promptEventRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setIsIos(detectIos());
    setIsAndroidChrome(detectAndroidChrome());
    setIsDesktop(detectDesktop());

    const next = readInt(VISITS_KEY) + 1;
    writeInt(VISITS_KEY, next);
    setVisitCount(next);

    setDismissedCount(readInt(DISMISSED_COUNT_KEY));
    setLastDismissedAt(readInt(DISMISSED_AT_KEY));

    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      e.preventDefault();
      promptEventRef.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  let reason: AddToHomeScreenReason | undefined;
  let canShow = false;

  if (isPwa === null) {
    // Hydrating.
  } else if (isPwa) {
    reason = "already-pwa";
  } else if (!isIos && !isAndroidChrome) {
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
      // swallow
    } finally {
      promptEventRef.current = null;
    }
  }, []);

  const trigger = useCallback(async (): Promise<"installed" | "dismissed" | "instructed"> => {
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
    if (isIos) return "instructed";
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
