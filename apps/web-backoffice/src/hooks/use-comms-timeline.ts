"use client";

/**
 * Organizer overhaul — Phase O5.
 *
 * React Query hook fetching the per-event comms timeline from
 * `/v1/events/:eventId/comms/timeline`. 60-second staleTime —
 * matches the inbox + health-card cadence so the operator gets
 * a coherent refresh rhythm across surfaces.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { CommunicationChannel, BroadcastStatus } from "@teranga/shared-types";

export type CommsTimelineEntryKind = "broadcast";

export interface CommsTimelineEntry {
  id: string;
  sourceId: string;
  kind: CommsTimelineEntryKind;
  at: string;
  channel: CommunicationChannel;
  status: BroadcastStatus;
  title: string;
  preview: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
}

export interface CommsTimelineResponse {
  entries: CommsTimelineEntry[];
  rangeStart: string | null;
  rangeEnd: string | null;
  computedAt: string;
}

interface CommsTimelineHttpResponse {
  success: boolean;
  data: CommsTimelineResponse;
}

const STALE_MS = 60_000;

export function useEventCommsTimeline(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["comms-timeline", eventId],
    queryFn: async () => {
      const res = await api.get<CommsTimelineHttpResponse>(`/v1/events/${eventId}/comms/timeline`);
      return res.data;
    },
    enabled: Boolean(eventId),
    staleTime: STALE_MS,
  });
}
