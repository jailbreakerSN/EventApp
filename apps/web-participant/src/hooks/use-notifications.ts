"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "@/lib/api-client";
import type { UpdateNotificationPreferenceDto } from "@teranga/shared-types";

export function useNotifications(
  params: { page?: number; limit?: number; unreadOnly?: boolean } = {},
) {
  return useQuery({
    queryKey: ["notifications", params],
    queryFn: () => notificationsApi.list(params),
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ["unread-count"],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 30_000,
  });
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markAsRead(notificationId),
    onMutate: async (notificationId: string) => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previousQueries = queryClient.getQueriesData({ queryKey: ["notifications"] });

      // Optimistically mark the notification as read
      queryClient.setQueriesData(
        { queryKey: ["notifications"] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (old: any) => {
          if (!old?.data) return old;
          return {
            ...old,
            data: old.data.map((n: { id: string; isRead: boolean }) =>
              n.id === notificationId ? { ...n, isRead: true } : n,
            ),
          };
        },
      );

      return { previousQueries };
    },
    onError: (_err, _id, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => notificationsApi.getPreferences(),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateNotificationPreferenceDto) => notificationsApi.updatePreferences(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
      // Phase B.2 — the catalog's `effectiveChannels` depends on the same
      // byKey map we just mutated, so its cached response is stale. Refetch
      // so the prefs UI reflects the newly-resolved per-channel state.
      queryClient.invalidateQueries({ queryKey: ["notification-catalog"] });
    },
  });
}

// ─── Phase B.2 — catalog + self test-send ──────────────────────────────────
// The preferences page (under /account/notifications/preferences) consumes
// these. Kept next to the other notification hooks so the mental model
// stays "one file per resource".

/**
 * GET /v1/notifications/catalog — 5-min stale time. The catalog is code-
 * driven plus admin overrides; neither is mutated from the participant
 * surface, so aggressive caching is safe and keeps the prefs page snappy
 * on 3G connections (the canonical African-market network floor).
 */
export function useNotificationCatalog() {
  return useQuery({
    queryKey: ["notification-catalog"],
    queryFn: () => notificationsApi.getCatalog(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * POST /v1/notifications/test-send — dispatches a self-targeted preview.
 * Does NOT surface user-facing copy from the hook: the participant UI is
 * next-intl-localised, so the page inspects `error.code` / `error.status`
 * and renders the right message via `t(...)`. Success toast is still fired
 * here with a generic key the caller translates.
 */
export function useTestSendSelf() {
  return useMutation({
    mutationFn: (key: string) => notificationsApi.testSendSelf(key),
  });
}
