"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { paymentsApi, promoCodesApi } from "@/lib/api-client";
import type { PaymentMethod } from "@teranga/shared-types";

export function useInitiatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      ticketTypeId,
      method,
      returnUrl,
    }: {
      eventId: string;
      ticketTypeId: string;
      method?: PaymentMethod;
      returnUrl?: string;
    }) => paymentsApi.initiate(eventId, ticketTypeId, method, returnUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
    },
  });
}

export function useValidatePromoCode() {
  return useMutation({
    mutationFn: ({
      eventId,
      code,
      ticketTypeId,
    }: {
      eventId: string;
      code: string;
      ticketTypeId: string;
    }) => promoCodesApi.validate(eventId, code, ticketTypeId),
  });
}

export function usePaymentStatus(paymentId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["payment-status", paymentId],
    queryFn: () => paymentsApi.getStatus(paymentId!),
    enabled: enabled && !!paymentId,
    refetchInterval: (query) => {
      const payment = query.state.data;
      const status = (payment as { data?: { status?: string } })?.data?.status;
      // Stop polling once payment reaches a terminal state
      if (status === "succeeded" || status === "failed" || status === "refunded" || status === "expired") {
        return false;
      }
      return 3000; // Poll every 3 seconds while processing
    },
  });
}
