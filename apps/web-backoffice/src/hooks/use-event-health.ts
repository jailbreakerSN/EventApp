"use client";

/**
 * Organizer overhaul — Phase O3.
 *
 * React Query hook that fetches `/v1/events/:eventId/health`. The
 * payload shape mirrors `EventHealthSnapshot` from the API. Cached
 * 60 s by default (matching the inbox auto-refresh cadence) — the
 * health score doesn't change second-to-second, but a freshly-edited
 * event should refresh quickly.
 *
 * Errors propagate via the standard React Query `error` field. The
 * consumer renders an inline placeholder (skeleton / "—") rather
 * than a global toast — the gauge is visual, not blocking.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type HealthTier = "critical" | "at_risk" | "healthy" | "excellent";

export interface HealthComponent {
  key: "publication" | "tickets" | "venue" | "pace" | "comms" | "staff" | "checkin";
  earned: number;
  max: number;
  label: string;
  detail: string;
}

export interface PacingPoint {
  date: string;
  dayIndex: number;
  actual: number;
  expected: number;
}

export interface EventHealthSnapshot {
  eventId: string;
  score: number;
  tier: HealthTier;
  components: HealthComponent[];
  pacing: PacingPoint[];
  pacingPercent: number | null;
  computedAt: string;
}

interface EventHealthResponse {
  success: boolean;
  data: EventHealthSnapshot;
}

const STALE_MS = 60_000;

export function useEventHealth(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["event-health", eventId],
    queryFn: async () => {
      const res = await api.get<EventHealthResponse>(`/v1/events/${eventId}/health`);
      return res.data;
    },
    enabled: Boolean(eventId),
    staleTime: STALE_MS,
  });
}
