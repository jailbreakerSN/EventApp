"use client";

import { useQuery } from "@tanstack/react-query";
import { badgesApi } from "@/lib/api-client";

export function useMyBadge(eventId: string) {
  return useQuery({
    queryKey: ["my-badge", eventId],
    queryFn: () => badgesApi.getMyBadge(eventId),
    enabled: !!eventId,
  });
}

export function useBadgeDownloadUrl(badgeId: string) {
  return useQuery({
    queryKey: ["badge-download", badgeId],
    queryFn: () => badgesApi.getDownloadUrl(badgeId),
    enabled: !!badgeId,
  });
}
