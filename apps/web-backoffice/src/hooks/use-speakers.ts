"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { speakersApi } from "@/lib/api-client";
import type { CreateSpeakerDto, UpdateSpeakerDto } from "@teranga/shared-types";

export function useEventSpeakers(eventId: string | undefined) {
  return useQuery({
    queryKey: ["speakers", eventId],
    queryFn: () => speakersApi.list(eventId!),
    enabled: !!eventId,
  });
}

export function useCreateSpeaker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { eventId: string; dto: CreateSpeakerDto }) =>
      speakersApi.create(args.eventId, args.dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["speakers"] });
    },
  });
}

export function useUpdateSpeaker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { speakerId: string; dto: Partial<UpdateSpeakerDto> }) =>
      speakersApi.update(args.speakerId, args.dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["speakers"] });
    },
  });
}

export function useDeleteSpeaker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (speakerId: string) => speakersApi.remove(speakerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["speakers"] });
    },
  });
}
