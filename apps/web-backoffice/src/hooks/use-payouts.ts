"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { payoutsApi } from "@/lib/api-client";

export function usePayoutCalculation(eventId: string | undefined, periodFrom: string, periodTo: string) {
  return useQuery({
    queryKey: ["payout-calculation", eventId, periodFrom, periodTo],
    queryFn: () => payoutsApi.calculate(eventId!, periodFrom, periodTo),
    enabled: !!eventId && !!periodFrom && !!periodTo,
  });
}

export function useOrgPayouts(orgId: string | undefined, params: { status?: string; page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["payouts", orgId, params],
    queryFn: () => payoutsApi.listByOrg(orgId!, params as Parameters<typeof payoutsApi.listByOrg>[1]),
    enabled: !!orgId,
  });
}

export function useCreatePayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { eventId: string; periodFrom: string; periodTo: string }) =>
      payoutsApi.create(args.eventId, args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payouts"] });
    },
  });
}
