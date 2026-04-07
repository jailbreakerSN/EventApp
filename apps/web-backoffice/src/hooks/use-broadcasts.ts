"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { broadcastsApi } from "@/lib/api-client";
import type { CreateBroadcastDto } from "@teranga/shared-types";

export function useEventBroadcasts(eventId: string | undefined, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["broadcasts", eventId, params],
    queryFn: () => broadcastsApi.list(eventId!, params),
    enabled: !!eventId,
  });
}

export function useSendBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateBroadcastDto) => broadcastsApi.send(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
    },
  });
}
