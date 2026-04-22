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
import { toast } from "sonner";
import { notificationsApi } from "@/lib/api-client";
import type { UpdateNotificationPreferenceDto } from "@teranga/shared-types";

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

// ─── Phase B.2 — per-user preferences (prefs page + per-channel grid) ──────
// These hooks back the /settings/notifications page. Separate from the
// list/bell hooks above because the cache lifetimes differ: preferences
// are edited rarely but consumed often by the prefs UI, while the list
// + unread-count polls every 30 s for the bell. The catalog is even more
// static (editorial content → 5 min stale) so it gets its own key.

/**
 * GET /v1/notifications/catalog — returns every catalog entry with the
 * Phase B.1 per-channel resolution baked in (`supportedChannels`,
 * `defaultChannels`, `effectiveChannels`, `userPreference`).
 *
 * 5-min stale time: the catalog is driven by code-side definitions and
 * admin overrides (which aren't mutated from this surface). Over-
 * refreshing burns Firestore reads the dispatcher could use instead.
 */
export function useNotificationCatalog() {
  return useQuery({
    queryKey: ["notification-catalog"],
    queryFn: () => notificationsApi.getCatalog(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * GET /v1/notifications/preferences — the flat preferences doc for the
 * caller. No polling: users open the prefs page, flip a toggle, leave.
 * Updates arrive via the PUT mutation's cache invalidation below.
 */
export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => notificationsApi.getPreferences(),
  });
}

/**
 * PUT /v1/notifications/preferences — accepts the widened byKey shape
 * (bare-boolean OR per-channel object) without coercion. Invalidates
 * both the preferences doc AND the catalog query because the catalog's
 * `effectiveChannels` map depends on the user's opt-out state and must
 * re-resolve after every flip.
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateNotificationPreferenceDto) => notificationsApi.updatePreferences(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
      queryClient.invalidateQueries({ queryKey: ["notification-catalog"] });
    },
  });
}

/**
 * POST /v1/notifications/test-send — self-targeted preview. Surfaces
 * server errors as Sonner toasts in French (backoffice is French-only).
 * 429 RATE_LIMITED and 400 NOT_OPTABLE get disambiguated copy; every
 * other failure falls back to the generic message so a new server error
 * code doesn't silently become "undefined".
 */
export function useTestSendSelf() {
  return useMutation({
    mutationFn: (key: string) => notificationsApi.testSendSelf(key),
    onSuccess: () => {
      toast.success("Notification envoyée dans votre boîte de réception.");
    },
    onError: (err: unknown) => {
      // ApiError shape is { code, message, status } — duck-typed here to
      // avoid importing the class (it's not exported from api-client).
      const e = err as { status?: number; code?: string; message?: string } | null;
      if (e?.status === 429 || e?.code === "RATE_LIMITED") {
        toast.error("Vous avez atteint la limite de tests (5/heure). Réessayez plus tard.");
        return;
      }
      if (e?.code === "NOT_OPTABLE") {
        toast.error("Cette notification est obligatoire et ne peut pas être simulée.");
        return;
      }
      toast.error(e?.message ?? "Échec de l'envoi du test.");
    },
  });
}
