"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { accessZonesApi } from "@/lib/api-client";
import type { CreateAccessZoneDto, UpdateAccessZoneDto } from "@teranga/shared-types";

export function useAddAccessZone(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateAccessZoneDto) => accessZonesApi.add(eventId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events", eventId] }),
  });
}

export function useUpdateAccessZone(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ zoneId, dto }: { zoneId: string; dto: Partial<UpdateAccessZoneDto> }) =>
      accessZonesApi.update(eventId, zoneId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events", eventId] }),
  });
}

export function useRemoveAccessZone(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (zoneId: string) => accessZonesApi.remove(eventId, zoneId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events", eventId] }),
  });
}
