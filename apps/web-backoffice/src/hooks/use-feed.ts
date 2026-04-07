"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { feedApi } from "@/lib/api-client";
import type { CreateFeedPostDto, CreateFeedCommentDto, FeedQuery } from "@teranga/shared-types";

export function useFeedPosts(eventId: string, query: Partial<FeedQuery> = {}) {
  return useQuery({
    queryKey: ["feed", eventId, query],
    queryFn: () => feedApi.list(eventId, query),
    enabled: !!eventId,
  });
}

export function useCreateFeedPost(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateFeedPostDto) => feedApi.create(eventId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
    },
  });
}

export function useToggleLike(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => feedApi.toggleLike(eventId, postId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
    },
  });
}

export function useTogglePin(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => feedApi.togglePin(eventId, postId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
    },
  });
}

export function useDeleteFeedPost(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => feedApi.deletePost(eventId, postId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
    },
  });
}

export function useFeedComments(eventId: string, postId: string) {
  return useQuery({
    queryKey: ["feed-comments", eventId, postId],
    queryFn: () => feedApi.listComments(eventId, postId),
    enabled: !!eventId && !!postId,
  });
}

export function useAddComment(eventId: string, postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateFeedCommentDto) => feedApi.addComment(eventId, postId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed-comments", eventId, postId] });
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
    },
  });
}
