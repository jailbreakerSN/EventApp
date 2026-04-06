"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { registrationsApi } from "@/lib/api-client";

export function useMyRegistrations(params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["my-registrations", params],
    queryFn: () => registrationsApi.getMyRegistrations(params),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, ticketTypeId }: { eventId: string; ticketTypeId: string }) =>
      registrationsApi.register(eventId, ticketTypeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
    },
  });
}

export function useCancelRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) => registrationsApi.cancel(registrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
    },
  });
}
