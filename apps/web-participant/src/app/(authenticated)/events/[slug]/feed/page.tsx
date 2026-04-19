"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { useFeed } from "@/hooks/use-feed";
import { AlertTriangle, ArrowLeft, Loader2, MessageSquare, RotateCcw } from "lucide-react";
import { Button, EmptyStateEditorial, SectionHeader } from "@teranga/shared-ui";
import Link from "next/link";
import { CreatePostForm } from "@/components/feed/CreatePostForm";
import { FeedPostCard } from "@/components/feed/FeedPostCard";
import { FeedPostSkeleton } from "@/components/feed/FeedPostSkeleton";
import { NewPostsBanner } from "@/components/feed/NewPostsBanner";
import { InfiniteScrollSentinel } from "@/components/feed/InfiniteScrollSentinel";
import { useTranslations } from "next-intl";

export default function FeedPage() {
  const t = useTranslations("feed");
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
      <div className="max-w-2xl mx-auto px-4 py-8">
        <EmptyStateEditorial
          icon={MessageSquare}
          kicker={t("notFoundKicker")}
          title={t("notFoundTitle")}
          action={
            <Link
              href="/events"
              className="text-sm font-medium text-teranga-gold-dark hover:underline"
            >
              {t("backToEvents")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <Link
        href={`/events/${event.slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("backToEvent")}
      </Link>

      <SectionHeader
        kicker={t("kicker")}
        title={t("title")}
        subtitle={event.title}
        size="hero"
        as="h1"
      />

      <CreatePostForm eventId={eventId} user={user} />

      {isLoadingFeed ? (
        <div className="space-y-4" role="status" aria-label={t("loadingLabel")}>
          <FeedPostSkeleton />
          <FeedPostSkeleton />
          <FeedPostSkeleton />
          <span className="sr-only">{t("loadingLabel")}</span>
        </div>
      ) : feedError ? (
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker={t("errorKicker")}
          title={t("errorTitle")}
          description={t("errorDescription")}
          action={
            <Button variant="outline" onClick={refresh}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("retry")}
            </Button>
          }
        />
      ) : posts.length === 0 ? (
        <EmptyStateEditorial
          icon={MessageSquare}
          kicker={t("emptyKicker")}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
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
