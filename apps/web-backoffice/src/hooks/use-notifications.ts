"use client";

/**
 * Notification hooks for the backoffice bell + history surfaces.
 *
 * Mirrors the participant app's shape so behaviour stays consistent across
 * both web front-ends (Phase 2.4 bell wiring). Polling-only — no Firestore
 * listener — because the backoffice topbar already refreshes on focus/tab-
 * return and the 30 s refetchInterval is plenty for sub-minute perceived
 * freshness while keeping Firestore read costs low.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "@/lib/api-client";

export function useNotifications(
  params: { page?: number; limit?: number; unreadOnly?: boolean } = {},
) {
  return useQuery({
    queryKey: ["notifications", params],
    queryFn: () => notificationsApi.list(params),
    staleTime: 30_000,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markAsRead(notificationId),
    onMutate: async (notificationId: string) => {
      // Cancel in-flight queries so the optimistic write isn't clobbered by a
      // stale response landing between onMutate and onSettled.
      await queryClient.cancelQueries({ queryKey: ["notifications"] });

      const previousQueries = queryClient.getQueriesData({ queryKey: ["notifications"] });

      // Optimistically mark the row as read in every list cache.
      queryClient.setQueriesData(
        { queryKey: ["notifications"] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (old: any) => {
          if (!old?.data || !Array.isArray(old.data)) return old;
          return {
            ...old,
            data: old.data.map((n: { id: string; isRead: boolean }) =>
              n.id === notificationId ? { ...n, isRead: true } : n,
            ),
          };
        },
      );

      // Optimistically decrement the unread-count badge. Clamp at 0.
      queryClient.setQueryData(
        ["notifications", "unread-count"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (old: any) => {
          if (!old?.data) return old;
          const current = typeof old.data.count === "number" ? old.data.count : 0;
          return { ...old, data: { ...old.data, count: Math.max(0, current - 1) } };
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
    },
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previousQueries = queryClient.getQueriesData({ queryKey: ["notifications"] });

      // Optimistically flip every cached row to read.
      queryClient.setQueriesData(
        { queryKey: ["notifications"] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (old: any) => {
          if (!old?.data || !Array.isArray(old.data)) return old;
          return {
            ...old,
            data: old.data.map((n: { isRead: boolean }) => ({ ...n, isRead: true })),
          };
        },
      );

      // Optimistic unread-count = 0.
      queryClient.setQueryData(
        ["notifications", "unread-count"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (old: any) => {
          if (!old?.data) return old;
          return { ...old, data: { ...old.data, count: 0 } };
        },
      );

      return { previousQueries };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
