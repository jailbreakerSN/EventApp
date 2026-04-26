"use client";

/**
 * Organizer overhaul — Phase O7.
 *
 * React Query hooks for the participant ops API surface:
 *   - profile read + mutate (tags + notes)
 *   - bulk-tag from registrations
 *   - duplicate detection + merge
 *
 * All hooks invalidate the relevant query keys on success so the
 * consuming UI re-renders without manual refetches.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  BulkTagRegistrationsDto,
  DuplicateCandidate,
  MergeParticipantsDto,
  ParticipantProfile,
  UpdateParticipantProfileDto,
} from "@teranga/shared-types";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

// ─── Profile read ────────────────────────────────────────────────────────

export function useParticipantProfile(
  orgId: string | null | undefined,
  userId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["participant-profile", orgId, userId],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<ParticipantProfile | null>>(
        `/v1/organizations/${orgId}/participants/${userId}/profile`,
      );
      return res.data;
    },
    enabled: Boolean(orgId && userId),
  });
}

// ─── Profile update (tags + notes) ───────────────────────────────────────

export function useUpdateParticipantProfile(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; dto: UpdateParticipantProfileDto }) => {
      const res = await api.patch<ApiEnvelope<ParticipantProfile>>(
        `/v1/organizations/${orgId}/participants/${input.userId}/profile`,
        input.dto,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["participant-profile", orgId, variables.userId] });
    },
  });
}

// ─── Bulk tag from registrations ─────────────────────────────────────────

export function useBulkTagRegistrations(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: BulkTagRegistrationsDto) => {
      const res = await api.post<ApiEnvelope<{ applied: number }>>(
        `/v1/organizations/${orgId}/participants/bulk-tag`,
        dto,
      );
      return res.data;
    },
    onSuccess: () => {
      // Invalidate the whole profile namespace — we don't know which
      // user ids were touched without re-resolving them client-side.
      qc.invalidateQueries({ queryKey: ["participant-profile", orgId] });
    },
  });
}

// ─── Duplicate detection ─────────────────────────────────────────────────

export function useDuplicateCandidates(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["participant-duplicates", orgId],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<DuplicateCandidate[]>>(
        `/v1/organizations/${orgId}/participants/duplicates`,
      );
      return res.data;
    },
    enabled: Boolean(orgId),
    // Refresh every 5 minutes — duplicates accumulate slowly.
    staleTime: 5 * 60_000,
  });
}

// ─── Merge participants ──────────────────────────────────────────────────

export function useMergeParticipants(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: MergeParticipantsDto) => {
      const res = await api.post<ApiEnvelope<{ registrationsMoved: number }>>(
        `/v1/organizations/${orgId}/participants/merge`,
        dto,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participant-duplicates", orgId] });
      qc.invalidateQueries({ queryKey: ["participant-profile", orgId] });
      // Registrations may have moved → invalidate every event's
      // registration list. Conservative: blow the whole namespace.
      qc.invalidateQueries({ queryKey: ["registrations"] });
    },
  });
}
