"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { registrationsApi } from "@/lib/api-client";

export function useMyRegistrations(params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["my-registrations", params],
    queryFn: () => registrationsApi.getMyRegistrations(params),
  });
}

/**
 * Phase B-1 — fetch the user's current ACTIVE registration for an
 * event (any non-terminal status), or `null` if none. Drives the
 * "right CTA" UX on the event detail page + register page.
 *
 * Returns `data: undefined` while loading, `data: { data: Registration | null }`
 * when resolved. Callers check `data?.data?.status` to switch between:
 *   - null            → render "S'inscrire" CTA
 *   - pending_payment → render "Compléter mon paiement" + "Annuler" buttons
 *   - confirmed       → render "Vous êtes inscrit" + "Voir mon badge"
 *   - waitlisted      → render waitlist position
 *   - checked_in      → render "Déjà accédé"
 *
 * `enabled: !!eventId` so the hook is a no-op until the eventId is
 * known (typical Next.js route-param hydration delay).
 */
export function useMyRegistrationForEvent(eventId: string | undefined | null) {
  return useQuery({
    queryKey: ["my-registration-for-event", eventId],
    queryFn: () => registrationsApi.getMyForEvent(eventId!),
    enabled: !!eventId,
    // Re-check on focus / interval so a payment that confirms in
    // another tab updates the CTA without a manual refresh.
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, ticketTypeId }: { eventId: string; ticketTypeId: string }) =>
      registrationsApi.register(eventId, ticketTypeId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      queryClient.invalidateQueries({
        queryKey: ["my-registration-for-event", vars.eventId],
      });
    },
  });
}

export function useCancelRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) => registrationsApi.cancel(registrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["my-registration-for-event"] });
    },
  });
}

/**
 * Phase B-3 — cancel a stuck pending_payment registration so the user
 * can re-register cleanly. Different mutation key from `useCancelRegistration`
 * so the UI can display a dedicated "Annulation en cours…" state and so
 * the analytics layer can distinguish the two flows. Invalidates the
 * same query keys to refresh the list / per-event lookup.
 */
export function useCancelPendingRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) =>
      registrationsApi.cancelPending(registrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["my-registration-for-event"] });
    },
  });
}
