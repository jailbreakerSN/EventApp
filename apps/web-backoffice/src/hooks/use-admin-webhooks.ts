"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api-client";
import type { AdminWebhookEventsQuery } from "@teranga/shared-types";

/**
 * T2.1 — Admin webhook events + replay hooks.
 *
 * Same pattern as useAdminJobs: list + get + replay mutation. Replay
 * invalidates the list on success so the table refreshes without a
 * manual reload.
 */

export function useAdminWebhookEvents(query: Partial<AdminWebhookEventsQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "webhooks", "list", query],
    queryFn: () => adminApi.listWebhookEvents(query),
    // Short stale time so operators see new deliveries land without a
    // page reload. Providers retry on their own cadence; a 15 s poll
    // is enough for admin visibility.
    refetchInterval: 15_000,
  });
}

export function useAdminWebhookEvent(webhookId: string | null) {
  return useQuery({
    queryKey: ["admin", "webhooks", "detail", webhookId],
    queryFn: () => adminApi.getWebhookEvent(webhookId!),
    enabled: !!webhookId,
  });
}

export function useReplayWebhookEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (webhookId: string) => adminApi.replayWebhookEvent(webhookId),
    onSuccess: (_res, webhookId) => {
      // The terminal row is returned from the mutation itself, but
      // we still refresh the list view + the detail query so status
      // badges elsewhere pick up the new state.
      void qc.invalidateQueries({ queryKey: ["admin", "webhooks", "list"] });
      void qc.invalidateQueries({ queryKey: ["admin", "webhooks", "detail", webhookId] });
    },
  });
}
