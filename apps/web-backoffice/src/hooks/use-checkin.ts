"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { checkinApi } from "@/lib/api-client";
import type { CheckinHistoryQuery } from "@teranga/shared-types";

export function useCheckinStats(eventId: string) {
  return useQuery({
    queryKey: ["checkin", "stats", eventId],
    queryFn: () => checkinApi.getStats(eventId),
    enabled: !!eventId,
    refetchInterval: 10_000,
  });
}

export function useCheckinHistory(
  eventId: string,
  params: Partial<CheckinHistoryQuery> = {},
) {
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
