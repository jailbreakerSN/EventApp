"use client";

/**
 * Organizer overhaul — Phase O10.
 *
 * React Query hooks for the event-templates surface:
 *   - `useEventTemplates`     — fetch the 8-template catalog (cached
 *                                indefinitely; the catalog is static).
 *   - `useCloneFromTemplate`  — POST + invalidates the events list
 *                                + navigates the caller to the new
 *                                event's overview.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { CloneFromTemplateDto, Event, EventTemplate } from "@teranga/shared-types";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

// The catalog is static data baked into shared-types — we cache it
// for the lifetime of the session. A `refetchInterval` is a waste;
// the only way the catalog changes is a deploy.
const CATALOG_STALE_MS = 60 * 60 * 1000; // 1 hour

export function useEventTemplates() {
  return useQuery({
    queryKey: ["event-templates"],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<EventTemplate[]>>("/v1/event-templates");
      return res.data;
    },
    staleTime: CATALOG_STALE_MS,
  });
}

export function useCloneFromTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      dto: CloneFromTemplateDto,
    ): Promise<{
      event: Event;
      templateId: string;
      sessionsAdded: number;
      commsBlueprintsAdded: number;
    }> => {
      const res = await api.post<
        ApiEnvelope<{
          event: Event;
          templateId: string;
          sessionsAdded: number;
          commsBlueprintsAdded: number;
        }>
      >("/v1/event-templates/clone", dto);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
