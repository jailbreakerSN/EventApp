"use client";

import { useQuery } from "@tanstack/react-query";
import { balanceApi } from "@/lib/api-client";
import type { BalanceTransactionQuery } from "@teranga/shared-types";

// ─── /finance Page Hooks ────────────────────────────────────────────────────
//
// Two queries feed the page: a balance summary (read-heavy, changes often)
// and a paginated transactions list (filtered by the Transactions tab
// filter bar). Both share the `orgId` cache key so invalidation is cheap.
//
// `staleTime` is zero by default (React Query v5) — operators refresh
// the page to see new data. When we wire the upcoming `refetchOnWindowFocus`
// experience we'll push it to 30s, but not before Wave 6 payment volume
// justifies it.

export function useOrgBalance(orgId: string | undefined) {
  return useQuery({
    queryKey: ["balance", orgId],
    queryFn: () => balanceApi.getSummary(orgId!),
    enabled: !!orgId,
  });
}

export function useOrgBalanceTransactions(
  orgId: string | undefined,
  query: Partial<BalanceTransactionQuery> = {},
) {
  return useQuery({
    queryKey: ["balance-transactions", orgId, query],
    queryFn: () => balanceApi.listTransactions(orgId!, query),
    enabled: !!orgId,
  });
}
