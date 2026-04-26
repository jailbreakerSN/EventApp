"use client";

/**
 * Organizer overhaul — Phase O5.
 *
 * React Query hook fetching the (currently static) communications
 * template library from `/v1/comms/templates`. Cached for 30 minutes
 * — the seed list ships with the product and doesn't move at
 * request-time, so a long staleTime cuts redundant network calls
 * without sacrificing freshness when a future iteration introduces
 * org-scoped custom templates.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { CommsTemplate, CommsTemplateCategory } from "@teranga/shared-types";

interface CommsTemplatesResponse {
  success: boolean;
  data: CommsTemplate[];
}

const STALE_MS = 30 * 60_000;

export function useCommsTemplates(category?: CommsTemplateCategory) {
  return useQuery({
    queryKey: ["comms-templates", category ?? "all"],
    queryFn: async () => {
      const path = category
        ? `/v1/comms/templates?category=${encodeURIComponent(category)}`
        : "/v1/comms/templates";
      const res = await api.get<CommsTemplatesResponse>(path);
      return res.data;
    },
    staleTime: STALE_MS,
  });
}
