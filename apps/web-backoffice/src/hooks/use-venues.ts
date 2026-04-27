"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { venuesApi } from "@/lib/api-client";
import type { VenueQuery, CreateVenueDto, UpdateVenueDto } from "@teranga/shared-types";

// ─── Queries ────────────────────────────────────────────────────────────────

export function useVenues(query: Partial<VenueQuery> = {}) {
  return useQuery({
    queryKey: ["venues", query],
    queryFn: () => venuesApi.listPublic(query),
  });
}

export function useVenue(venueId: string) {
  return useQuery({
    queryKey: ["venues", venueId],
    queryFn: () => venuesApi.getById(venueId),
    enabled: !!venueId,
  });
}

export function useMyVenues(params: Partial<VenueQuery> = {}) {
  return useQuery({
    queryKey: ["venues", "mine", params],
    queryFn: () => venuesApi.listMyVenues(params),
  });
}

export function useVenueEvents(venueId: string, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["venues", venueId, "events", params],
    queryFn: () => venuesApi.getEvents(venueId, params),
    enabled: !!venueId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useCreateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateVenueDto) => venuesApi.create(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venues"] });
    },
  });
}

export function useUpdateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ venueId, dto }: { venueId: string; dto: Partial<UpdateVenueDto> }) =>
      venuesApi.update(venueId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venues"] });
    },
  });
}

export function useApproveVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (venueId: string) => venuesApi.approve(venueId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venues"] });
    },
  });
}

export function useSuspendVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (venueId: string) => venuesApi.suspend(venueId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venues"] });
    },
  });
}

export function useReactivateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (venueId: string) => venuesApi.reactivate(venueId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venues"] });
    },
  });
}
