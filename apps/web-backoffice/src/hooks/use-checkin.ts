"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { checkinApi } from "@/lib/api-client";
import { usePlanGating } from "@/hooks/use-plan-gating";
import type { AnomalyQuery, CheckinHistoryQuery } from "@teranga/shared-types";

export function useCheckinStats(eventId: string) {
  return useQuery({
    queryKey: ["checkin", "stats", eventId],
    queryFn: () => checkinApi.getStats(eventId),
    enabled: !!eventId,
    refetchInterval: 10_000,
  });
}

/**
 * Polls the security-anomalies endpoint for the live dashboard widget.
 * Gated client-side by `advancedAnalytics` so free/starter orgs don't
 * burn the per-minute rate limit (the server rejects them anyway, but
 * the skipped fetch keeps the upsell card responsive and avoids the
 * 30/min budget being consumed by someone tab-switching).
 *
 * `paused` lets the caller freeze polling — e.g. while an evidence
 * drill-down is expanded — so the row the user is inspecting doesn't
 * re-render out from under them.
 */
export function useCheckinAnomalies(
  eventId: string,
  params: Partial<AnomalyQuery> = {},
  opts: { paused?: boolean } = {},
) {
  const { canUse } = usePlanGating();
  const enabled = !!eventId && canUse("advancedAnalytics");
  return useQuery({
    queryKey: ["checkin", "anomalies", eventId, params],
    queryFn: () => checkinApi.getAnomalies(eventId, params),
    enabled,
    refetchInterval: opts.paused ? false : 10_000,
  });
}

export function useCheckinHistory(eventId: string, params: Partial<CheckinHistoryQuery> = {}) {
  return useQuery({
    queryKey: ["checkin", "history", eventId, params],
    queryFn: () => checkinApi.getHistory(eventId, params),
    enabled: !!eventId,
  });
}

export function usePerformCheckin(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ qrCodeValue, accessZoneId }: { qrCodeValue: string; accessZoneId?: string }) =>
      checkinApi.performCheckin(qrCodeValue, accessZoneId),
    onSuccess: () => {
      // Invalidate stats and history so they refresh
      queryClient.invalidateQueries({ queryKey: ["checkin", "stats", eventId] });
      queryClient.invalidateQueries({ queryKey: ["checkin", "history", eventId] });
    },
  });
}
