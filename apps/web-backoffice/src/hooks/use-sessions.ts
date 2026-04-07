"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionsApi } from "@/lib/api-client";
import type { CreateSessionDto, UpdateSessionDto, SessionScheduleQuery } from "@teranga/shared-types";

export function useSessions(eventId: string, query: Partial<SessionScheduleQuery> = {}) {
  return useQuery({
    queryKey: ["sessions", eventId, query],
    queryFn: () => sessionsApi.list(eventId, query),
    enabled: !!eventId,
  });
}

export function useSession(eventId: string, sessionId: string) {
  return useQuery({
    queryKey: ["session", eventId, sessionId],
    queryFn: () => sessionsApi.getById(eventId, sessionId),
    enabled: !!eventId && !!sessionId,
  });
}

export function useCreateSession(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateSessionDto) => sessionsApi.create(eventId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions", eventId] });
    },
  });
}

export function useUpdateSession(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, dto }: { sessionId: string; dto: Partial<UpdateSessionDto> }) =>
      sessionsApi.update(eventId, sessionId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions", eventId] });
    },
  });
}

export function useDeleteSession(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => sessionsApi.delete(eventId, sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions", eventId] });
    },
  });
}

export function useSessionBookmarks(eventId: string) {
  return useQuery({
    queryKey: ["session-bookmarks", eventId],
    queryFn: () => sessionsApi.getBookmarks(eventId),
    enabled: !!eventId,
  });
}
