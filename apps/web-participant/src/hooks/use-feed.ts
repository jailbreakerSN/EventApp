"use client";

import { useState, useCallback, useMemo } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { feedApi } from "@/lib/api-client";
import type { FeedPost } from "@teranga/shared-types";

const FEED_PAGE_SIZE = 15;
const POLL_INTERVAL = 30_000; // 30 seconds

interface UseFeedOptions {
  eventId: string;
  enabled?: boolean;
}

export function useFeed({ eventId, enabled = true }: UseFeedOptions) {
  const qc = useQueryClient();
  const [newPostCount, setNewPostCount] = useState(0);

  // Main infinite query for feed posts
  const infiniteQuery = useInfiniteQuery({
    queryKey: ["feed", eventId],
    queryFn: ({ pageParam }) => feedApi.list(eventId, { page: pageParam, limit: FEED_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.meta;
      return page < totalPages ? page + 1 : undefined;
    },
    enabled: enabled && !!eventId,
    staleTime: 60_000,
  });

  // Flatten all pages into a single posts array
  const posts: FeedPost[] = useMemo(
    () => infiniteQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [infiniteQuery.data],
  );

  // Polling query — fetches only page 1 to detect new posts
  const firstPostId = posts[0]?.id;

  useQuery({
    queryKey: ["feed-poll", eventId, firstPostId],
    queryFn: async () => {
      const result = await feedApi.list(eventId, { page: 1, limit: 1 });
      const latestPostId = result.data[0]?.id;

      if (latestPostId && firstPostId && latestPostId !== firstPostId) {
        // Count how many new posts exist by checking total difference
        const currentTotal = infiniteQuery.data?.pages[0]?.meta.total ?? 0;
        const newTotal = result.meta.total;
        const diff = newTotal - currentTotal;
        if (diff > 0) {
          setNewPostCount(diff);
        }
      }

      return result;
    },
    enabled: enabled && !!eventId && !!firstPostId,
    refetchInterval: POLL_INTERVAL,
    staleTime: POLL_INTERVAL,
  });

  // Refresh feed (clears new post banner + refetches)
  const refresh = useCallback(() => {
    setNewPostCount(0);
    qc.invalidateQueries({ queryKey: ["feed", eventId] });
    qc.invalidateQueries({ queryKey: ["feed-poll", eventId] });
  }, [qc, eventId]);

  // Dismiss the new posts banner without refreshing
  const dismissNewPosts = useCallback(() => {
    setNewPostCount(0);
  }, []);

  return {
    posts,
    isLoading: infiniteQuery.isLoading,
    isFetchingNextPage: infiniteQuery.isFetchingNextPage,
    hasNextPage: infiniteQuery.hasNextPage ?? false,
    fetchNextPage: infiniteQuery.fetchNextPage,
    newPostCount,
    refresh,
    dismissNewPosts,
  };
}
