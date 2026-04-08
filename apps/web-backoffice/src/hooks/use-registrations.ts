"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { registrationsApi } from "@/lib/api-client";

export function useEventRegistrations(
  eventId: string,
  params: { page?: number; limit?: number; status?: string } = {}
) {
  return useQuery({
    queryKey: ["registrations", eventId, params],
    queryFn: () => registrationsApi.getEventRegistrations(eventId, params as Parameters<typeof registrationsApi.getEventRegistrations>[1]),
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
