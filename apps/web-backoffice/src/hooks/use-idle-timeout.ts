"use client";

import { useEffect, useRef, useCallback } from "react";

interface UseIdleTimeoutOptions {
  /** Time in ms before the timeout callback fires (default: 30 min) */
  timeoutMs?: number;
  /** Time in ms before the warning callback fires (default: 25 min) */
  warningMs?: number;
  /** Called when the warning threshold is reached */
  onWarning?: () => void;
  /** Called when the timeout threshold is reached */
  onTimeout?: () => void;
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_WARNING_MS = 25 * 60 * 1000; // 25 minutes
const THROTTLE_MS = 30_000; // 30 seconds — don't reset timers more often than this

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
];

export function useIdleTimeout({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  warningMs = DEFAULT_WARNING_MS,
  onWarning,
  onTimeout,
  enabled = true,
}: UseIdleTimeoutOptions = {}) {
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const warningFiredRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const startTimers = useCallback(() => {
    clearTimers();
    warningFiredRef.current = false;

    warningTimerRef.current = setTimeout(() => {
      warningFiredRef.current = true;
      onWarning?.();
    }, warningMs);

    timeoutTimerRef.current = setTimeout(() => {
      onTimeout?.();
    }, timeoutMs);
  }, [clearTimers, warningMs, timeoutMs, onWarning, onTimeout]);

  const handleActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityRef.current < THROTTLE_MS) return;
    lastActivityRef.current = now;
    startTimers();
  }, [startTimers]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      return;
    }

    // Start timers on mount
    startTimers();

    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      clearTimers();
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, handleActivity);
      }
    };
  }, [enabled, startTimers, handleActivity, clearTimers]);
}
