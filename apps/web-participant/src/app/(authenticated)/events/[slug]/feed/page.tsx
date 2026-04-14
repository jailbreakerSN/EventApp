"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { useFeed } from "@/hooks/use-feed";
import { MessageSquare, ArrowLeft, Loader2 } from "lucide-react";
import { QueryError, EmptyState } from "@teranga/shared-ui";
import Link from "next/link";
import { CreatePostForm } from "@/components/feed/CreatePostForm";
import { FeedPostCard } from "@/components/feed/FeedPostCard";
import { FeedPostSkeleton } from "@/components/feed/FeedPostSkeleton";
import { NewPostsBanner } from "@/components/feed/NewPostsBanner";
import { InfiniteScrollSentinel } from "@/components/feed/InfiniteScrollSentinel";

export default function FeedPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();

  // Resolve slug → event (gets us the real eventId)
  const { data: eventData, isLoading: isLoadingEvent } = useQuery({
    queryKey: ["event-by-slug", slug],
    queryFn: () => eventsApi.getBySlug(slug),
    enabled: !!slug,
    staleTime: 5 * 60_000,
  });

  const event = eventData?.data;
  const eventId = event?.id;

  const {
    posts,
    isLoading: isLoadingFeed,
    isError: feedError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    newPostCount,
    refresh,
  } = useFeed({ eventId: eventId ?? "", enabled: !!eventId });

  // Show loader while resolving slug → event
  if (isLoadingEvent) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Event not found
  if (!event || !eventId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 text-center">
        <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
        <p className="text-lg text-muted-foreground">Événement introuvable</p>
        <Link href="/events" className="mt-4 inline-block text-sm text-primary hover:underline">
          Retour aux événements
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link
        href={`/events/${event.slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à l&apos;événement
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <MessageSquare className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Feed</h1>
          <p className="text-sm text-muted-foreground">{event.title}</p>
        </div>
      </div>

      <CreatePostForm eventId={eventId} user={user} />

      {isLoadingFeed ? (
        <div className="space-y-4" role="status" aria-label="Chargement du feed...">
          <FeedPostSkeleton />
          <FeedPostSkeleton />
          <FeedPostSkeleton />
          <span className="sr-only">Chargement du feed...</span>
        </div>
      ) : feedError ? (
        <QueryError message="Impossible de charger le feed." onRetry={refresh} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Aucune publication pour le moment"
          description="Soyez le premier à partager une publication avec les participants."
        />
      ) : (
        <>
          <NewPostsBanner count={newPostCount} onRefresh={refresh} />

          <div className="space-y-4">
            {posts.map((post) => (
              <FeedPostCard key={post.id} post={post} eventId={eventId} currentUserId={user?.uid} />
            ))}
          </div>

          <InfiniteScrollSentinel
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={() => fetchNextPage()}
          />
        </>
      )}
    </div>
  );
}
