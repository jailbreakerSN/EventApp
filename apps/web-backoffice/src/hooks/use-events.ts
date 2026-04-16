"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import type {
  CreateEventDto,
  UpdateEventDto,
  CreateTicketTypeDto,
  UpdateTicketTypeDto,
  EventCategory,
  EventStatus,
} from "@teranga/shared-types";

/**
 * Fetch events scoped to the current user's organization.
 * Falls back to public search only if no organizationId is set (should not happen in backoffice).
 */
export function useEvents(
  params: {
    page?: number;
    limit?: number;
    orderBy?: string;
    orderDir?: string;
    category?: EventCategory | "";
    status?: EventStatus | "";
  } = {},
) {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  return useQuery({
    queryKey: ["events", "org", orgId, params],
    queryFn: () => {
      if (!orgId) {
        throw new Error(
          "Organization ID is missing. Please contact your administrator to ensure your account is assigned to an organization.",
        );
      }
      return eventsApi.listByOrg(orgId, params);
    },
    enabled: !!user && !!orgId,
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
    mutationFn: ({
      ticketTypeId,
      dto,
    }: {
      ticketTypeId: string;
      dto: Partial<UpdateTicketTypeDto>;
    }) => eventsApi.updateTicketType(eventId, ticketTypeId, dto),
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
