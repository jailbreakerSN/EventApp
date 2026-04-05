"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api-client";
import type {
  CreateEventDto,
  UpdateEventDto,
  EventSearchQuery,
  CreateTicketTypeDto,
  UpdateTicketTypeDto,
} from "@teranga/shared-types";

export function useEvents(query: Partial<EventSearchQuery> = {}) {
  return useQuery({
    queryKey: ["events", query],
    queryFn: () => eventsApi.search(query),
  });
}

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: ["events", eventId],
    queryFn: () => eventsApi.getById(eventId),
    enabled: !!eventId,
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateEventDto) => eventsApi.create(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function useUpdateEvent(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: Partial<UpdateEventDto>) => eventsApi.update(eventId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", eventId] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function usePublishEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => eventsApi.publish(eventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function useUnpublishEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => eventsApi.unpublish(eventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function useCancelEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => eventsApi.cancel(eventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function useAddTicketType(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateTicketTypeDto) => eventsApi.addTicketType(eventId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events", eventId] }),
  });
}

export function useUpdateTicketType(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketTypeId, dto }: { ticketTypeId: string; dto: Partial<UpdateTicketTypeDto> }) =>
      eventsApi.updateTicketType(eventId, ticketTypeId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events", eventId] }),
  });
}

export function useRemoveTicketType(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketTypeId: string) => eventsApi.removeTicketType(eventId, ticketTypeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events", eventId] }),
  });
}
