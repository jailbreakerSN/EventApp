"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { registrationsApi } from "@/lib/api-client";

export function useEventRegistrations(
  eventId: string,
  params: {
    page?: number;
    limit?: number;
    /**
     * Single status or array (multi-select). Multi values are comma-joined
     * for the wire — the route's Zod preprocess splits them back into an
     * array and validates each against `RegistrationStatusSchema`.
     */
    status?: string | string[];
    orderBy?: "createdAt" | "updatedAt" | "status";
    orderDir?: "asc" | "desc";
  } = {},
) {
  // Normalise array → csv at the call site so the queryKey stays stable
  // regardless of the array's reference identity between renders.
  const wireParams = {
    ...params,
    status: Array.isArray(params.status) ? params.status.join(",") : params.status,
  };
  return useQuery({
    queryKey: ["registrations", eventId, wireParams],
    queryFn: () =>
      registrationsApi.getEventRegistrations(
        eventId,
        wireParams as Parameters<typeof registrationsApi.getEventRegistrations>[1],
      ),
    enabled: !!eventId,
  });
}

export function useApproveRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) => registrationsApi.approve(registrationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registrations"] }),
  });
}

export function useCancelRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) => registrationsApi.cancel(registrationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registrations"] }),
  });
}

export function usePromoteRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) => registrationsApi.promote(registrationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registrations"] }),
  });
}
