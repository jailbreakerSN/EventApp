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
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      queryClient.invalidateQueries({
        queryKey: ["my-registration-for-event", vars.eventId],
      });
    },
  });
}

/**
 * Phase B-2 — resume a payment that's stuck in `processing` (user
 * came back from PayDunya without finishing). Returns the existing
 * redirectUrl so the user re-launches the SAME PayDunya checkout
 * session — no new invoice, no double-charge, no orphan Payment.
 *
 * The mutation does NOT auto-redirect: the caller decides what to do
 * with the response (typically `window.location.href = data.redirectUrl`).
 * This keeps the hook composable with both the register page (full
 * redirect) and the my-events list (could open in a new tab).
 */
export function useResumePayment() {
  return useMutation({
    mutationFn: (paymentId: string) => paymentsApi.resume(paymentId),
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
