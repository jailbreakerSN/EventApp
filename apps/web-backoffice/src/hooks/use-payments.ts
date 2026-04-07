"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { paymentsApi } from "@/lib/api-client";

export function useEventPayments(eventId: string, params: { status?: string; method?: string; page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["event-payments", eventId, params],
    queryFn: () => paymentsApi.listByEvent(eventId, params),
    enabled: !!eventId,
  });
}

export function usePaymentSummary(eventId: string) {
  return useQuery({
    queryKey: ["payment-summary", eventId],
    queryFn: () => paymentsApi.getSummary(eventId),
    enabled: !!eventId,
  });
}

export function useRefundPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, amount, reason }: { paymentId: string; amount?: number; reason?: string }) =>
      paymentsApi.refund(paymentId, { amount, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-payments"] });
      queryClient.invalidateQueries({ queryKey: ["payment-summary"] });
    },
  });
}
