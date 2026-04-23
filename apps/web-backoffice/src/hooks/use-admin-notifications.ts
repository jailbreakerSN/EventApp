import { useQuery } from "@tanstack/react-query";
import {
  adminNotificationsApi,
  type AdminDeliveryDashboardQuery,
  type AdminDeliveryDashboardResponse,
} from "@/lib/api-client";

// ─── Admin notification observability hooks (Phase D.3) ───────────────────
// Thin React Query wrappers over the super-admin delivery dashboard
// endpoint. Kept in a dedicated file (rather than inlined into
// `use-admin.ts`) because the admin notifications surface has its own
// query-key namespace and cache-invalidation rules — a catalog edit
// should not blow away the delivery dashboard cache.

const QUERY_KEY_ROOT = ["admin", "notifications", "delivery"] as const;

export function adminDeliveryQueryKey(params: AdminDeliveryDashboardQuery = {}) {
  // Stable, serialisable key so two identical filter sets share a cache
  // entry. React Query uses structural equality, so the normalised
  // undefined keys are safe to drop.
  return [...QUERY_KEY_ROOT, params] as const;
}

/**
 * Fetches the per-channel delivery totals + time-series + suppression
 * breakdown for the super-admin observability dashboard.
 *
 * Cache semantics: 60s staleTime matches the 60 req/min rate-limit at the
 * route layer — avoid refetching on every render without going above the
 * budget. `keepPreviousData` keeps the dashboard chart visible while the
 * user flips filters, so the UI doesn't flash a skeleton on every click.
 */
export function useAdminDeliveryDashboard(params: AdminDeliveryDashboardQuery = {}) {
  return useQuery<{ data: AdminDeliveryDashboardResponse; success: boolean }>({
    queryKey: adminDeliveryQueryKey(params),
    queryFn: () => adminNotificationsApi.delivery(params),
    staleTime: 60_000,
    // Two retries max — on 429 or 400 there's no point retrying, the error
    // banner should surface immediately. React Query's default (3) makes
    // the dashboard feel stuck when an invalid window is typed.
    retry: (failureCount, err: unknown) => {
      const status =
        (err as { status?: number } | undefined)?.status ?? 0;
      if (status === 400 || status === 429 || status === 403) return false;
      return failureCount < 2;
    },
  });
}
