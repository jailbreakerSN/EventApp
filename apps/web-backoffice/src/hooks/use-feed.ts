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

export function useToggleLike(eventId: string, currentUserId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => feedApi.toggleLike(eventId, postId),
    onMutate: async (postId: string) => {
      // Cancel in-flight feed queries to avoid overwrites
      await qc.cancelQueries({ queryKey: ["feed", eventId] });

      // Snapshot previous data for rollback
      const previousQueries = qc.getQueriesData({ queryKey: ["feed", eventId] });

      // Optimistically update the like state in all matching feed queries
      if (currentUserId) {
        qc.setQueriesData(
          { queryKey: ["feed", eventId] },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (old: any) => {
            if (!old?.data) return old;
            return {
              ...old,
              data: old.data.map(
                (post: { id: string; likedByIds: string[]; likeCount: number }) => {
                  if (post.id !== postId) return post;
                  const isLiked = post.likedByIds.includes(currentUserId);
                  return {
                    ...post,
                    likedByIds: isLiked
                      ? post.likedByIds.filter((id: string) => id !== currentUserId)
                      : [...post.likedByIds, currentUserId],
                    likeCount: isLiked ? post.likeCount - 1 : post.likeCount + 1,
                  };
                },
              ),
            };
          },
        );
      }

      return { previousQueries };
    },
    onError: (_err, _postId, context) => {
      // Rollback to previous state on error
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          qc.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      // Always refetch after mutation to ensure server state
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
