"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { badgesApi } from "@/lib/api-client";

function cacheBadgeInServiceWorker(url: string): void {
  if (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    navigator.serviceWorker.controller
  ) {
    navigator.serviceWorker.controller.postMessage({
      type: "CACHE_BADGE",
      url,
    });
  }
}

export function useMyBadge(eventId: string) {
  const query = useQuery({
    queryKey: ["my-badge", eventId],
    queryFn: () => badgesApi.getMyBadge(eventId),
    enabled: !!eventId,
  });

  useEffect(() => {
    if (query.data && eventId) {
      cacheBadgeInServiceWorker(`/v1/badges/me/${eventId}`);
    }
  }, [query.data, eventId]);

  return query;
}

export function useBadgeDownloadUrl(badgeId: string) {
  const query = useQuery({
    queryKey: ["badge-download", badgeId],
    queryFn: () => badgesApi.getDownloadUrl(badgeId),
    enabled: !!badgeId,
  });

  useEffect(() => {
    if (query.data && badgeId) {
      cacheBadgeInServiceWorker(`/v1/badges/${badgeId}/download`);
    }
  }, [query.data, badgeId]);

  return query;
}

export { cacheBadgeInServiceWorker };
