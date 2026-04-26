"use client";

/**
 * Organizer overhaul — Phase O2.
 *
 * Data hook for the organizer inbox landing (`/inbox`). Mirrors the
 * admin inbox auto-refresh contract:
 *   - Initial fetch on mount.
 *   - Visibility-aware polling at REFRESH_INTERVAL_MS (60 s).
 *   - Exponential backoff (× 2, capped × 10) on transport failure.
 *   - Reset backoff to 1 on the first successful fetch.
 *
 * The hook is intentionally local-state-driven (useState + useEffect)
 * rather than React Query so the polling cadence + backoff are
 * trivially auditable. The admin page uses the same shape — they can
 * both be lifted into a shared `useTaskInbox` later if a third
 * persona arrives.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";

export type OrganizerSignalCategory =
  | "urgent"
  | "today"
  | "week"
  | "growth"
  | "moderation"
  | "team";

export type OrganizerSignalSeverity = "info" | "warning" | "critical";

export interface OrganizerInboxSignal {
  id: string;
  category: OrganizerSignalCategory;
  severity: OrganizerSignalSeverity;
  title: string;
  description: string;
  count: number;
  href: string;
}

export interface OrganizerInboxResponse {
  success: boolean;
  data: {
    signals: OrganizerInboxSignal[];
    computedAt: string;
  };
}

export interface UseOrganizerInboxResult {
  signals: OrganizerInboxSignal[] | null;
  error: string | null;
  lastUpdate: string | null;
  refreshing: boolean;
  refetch: () => void;
}

export const ORGANIZER_INBOX_REFRESH_MS = 60_000;
const ORGANIZER_INBOX_BACKOFF_MAX = 10;

export function useOrganizerInbox(): UseOrganizerInboxResult {
  const [signals, setSignals] = useState<OrganizerInboxSignal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Exponential-backoff multiplier — doubled on every transport
  // failure, capped at × 10 (so the worst-case delay is 10 minutes
  // between polls during a sustained outage). Reset to 1 on the
  // first successful fetch.
  const backoffRef = useRef(1);

  const fetchSignals = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await api.get<OrganizerInboxResponse>("/v1/me/inbox");
      setSignals(res.data.signals);
      setLastUpdate(res.data.computedAt);
      setError(null);
      backoffRef.current = 1;
    } catch (err) {
      setError((err as Error)?.message ?? "Erreur inconnue");
      backoffRef.current = Math.min(backoffRef.current * 2, ORGANIZER_INBOX_BACKOFF_MAX);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchSignals();
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        await fetchSignals();
      }
      const nextDelay = ORGANIZER_INBOX_REFRESH_MS * backoffRef.current;
      timerId = setTimeout(() => void tick(), nextDelay);
    };
    timerId = setTimeout(() => void tick(), ORGANIZER_INBOX_REFRESH_MS);
    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [fetchSignals]);

  return {
    signals,
    error,
    lastUpdate,
    refreshing,
    refetch: () => void fetchSignals(),
  };
}
