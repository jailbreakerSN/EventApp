"use client";

/**
 * Organizer overhaul — Phase O8.
 *
 * React Query hooks for the live event mode (Floor Ops):
 *   - `useLiveStats`        — dashboard read model, 60 s polling.
 *   - `useIncidents`        — incident list + filtered by status.
 *   - `useCreateIncident`   — log a new incident.
 *   - `useUpdateIncident`   — assign / change status / resolve.
 *   - `useStaffMessages`    — cold-start fallback (the live page
 *                             prefers a realtime listener for chat).
 *   - `usePostStaffMessage` — append to the staff radio.
 *   - `useEmergencyBroadcast` — multi-channel emergency fan-out.
 *
 * Each mutation invalidates the relevant query namespaces so the
 * dashboard re-renders without manual refetches.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  CreateIncidentDto,
  CreateStaffMessageDto,
  EmergencyBroadcastDto,
  EmergencyBroadcastResult,
  Incident,
  IncidentStatus,
  LiveStats,
  StaffMessage,
  UpdateIncidentDto,
} from "@teranga/shared-types";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

const STATS_STALE_MS = 60_000;

// ─── Live stats ────────────────────────────────────────────────────────────

export function useLiveStats(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["live-stats", eventId],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<LiveStats>>(`/v1/events/${eventId}/live/stats`);
      return res.data;
    },
    enabled: Boolean(eventId),
    staleTime: STATS_STALE_MS,
    refetchInterval: STATS_STALE_MS,
  });
}

// ─── Incidents ─────────────────────────────────────────────────────────────

export function useIncidents(eventId: string | null | undefined, status?: IncidentStatus) {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return useQuery({
    queryKey: ["incidents", eventId, status ?? "all"],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<Incident[]>>(
        `/v1/events/${eventId}/live/incidents${params}`,
      );
      return res.data;
    },
    enabled: Boolean(eventId),
    staleTime: 15_000,
  });
}

export function useCreateIncident(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateIncidentDto) => {
      const res = await api.post<ApiEnvelope<Incident>>(
        `/v1/events/${eventId}/live/incidents`,
        dto,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents", eventId] });
      qc.invalidateQueries({ queryKey: ["live-stats", eventId] });
    },
  });
}

export function useUpdateIncident(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { incidentId: string; dto: UpdateIncidentDto }) => {
      const res = await api.patch<ApiEnvelope<Incident>>(
        `/v1/events/${eventId}/live/incidents/${input.incidentId}`,
        input.dto,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents", eventId] });
      qc.invalidateQueries({ queryKey: ["live-stats", eventId] });
    },
  });
}

// ─── Staff messages ────────────────────────────────────────────────────────

export function useStaffMessages(eventId: string | null | undefined, limit = 100) {
  return useQuery({
    queryKey: ["staff-messages", eventId, limit],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<StaffMessage[]>>(
        `/v1/events/${eventId}/live/staff-messages?limit=${limit}`,
      );
      return res.data;
    },
    enabled: Boolean(eventId),
    // Frontend should use a Firestore realtime listener to keep
    // messages flowing between polls; the staleTime here is the
    // cold-start fallback only.
    staleTime: 30_000,
  });
}

export function usePostStaffMessage(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateStaffMessageDto) => {
      const res = await api.post<ApiEnvelope<StaffMessage>>(
        `/v1/events/${eventId}/live/staff-messages`,
        dto,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-messages", eventId] });
    },
  });
}

// ─── Emergency broadcast ───────────────────────────────────────────────────

export function useEmergencyBroadcast(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: EmergencyBroadcastDto) => {
      const res = await api.post<ApiEnvelope<EmergencyBroadcastResult>>(
        `/v1/events/${eventId}/live/emergency-broadcast`,
        dto,
      );
      return res.data;
    },
    onSuccess: () => {
      // The fan-out also creates a regular Broadcast doc, so invalidate
      // the comms timeline + recent broadcasts list.
      qc.invalidateQueries({ queryKey: ["comms-timeline", eventId] });
      qc.invalidateQueries({ queryKey: ["broadcasts", eventId] });
    },
  });
}
