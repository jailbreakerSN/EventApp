"use client";

import { useQuery } from "@tanstack/react-query";
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
