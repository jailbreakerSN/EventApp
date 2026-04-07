"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sponsorsApi } from "@/lib/api-client";
import type { CreateSponsorDto, UpdateSponsorDto } from "@teranga/shared-types";

export function useEventSponsors(eventId: string | undefined, params: { tier?: string } = {}) {
  return useQuery({
    queryKey: ["sponsors", eventId, params],
    queryFn: () => sponsorsApi.list(eventId!, params),
    enabled: !!eventId,
  });
}

export function useCreateSponsor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { eventId: string; dto: CreateSponsorDto }) =>
      sponsorsApi.create(args.eventId, args.dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsors"] });
    },
  });
}

export function useUpdateSponsor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { sponsorId: string; dto: Partial<UpdateSponsorDto> }) =>
      sponsorsApi.update(args.sponsorId, args.dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsors"] });
    },
  });
}

export function useDeleteSponsor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sponsorId: string) => sponsorsApi.remove(sponsorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsors"] });
    },
  });
}

export function useSponsorLeads(sponsorId: string | undefined, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["sponsor-leads", sponsorId, params],
    queryFn: () => sponsorsApi.listLeads(sponsorId!, params),
    enabled: !!sponsorId,
  });
}
