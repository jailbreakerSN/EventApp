"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionsApi, eventsApi } from "@/lib/api-client";
import { Calendar, Clock, Mic, Bookmark, Loader2, ArrowLeft, AlertTriangle } from "lucide-react";
import { EmptyStateEditorial, SectionHeader } from "@teranga/shared-ui";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/intl-locale";

function formatTime(iso: string, regional: string) {
  return new Date(iso).toLocaleString(regional, {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Dakar",
  });
}

export default function SchedulePage() {
  const t = useTranslations("schedule");
  const tCommon = useTranslations("common");
  void tCommon;
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();

  // Resolve slug → event (gets us the real eventId)
  const { data: eventData, isLoading: isLoadingEvent } = useQuery({
    queryKey: ["event-by-slug", slug],
    queryFn: () => eventsApi.getBySlug(slug),
    enabled: !!slug,
    staleTime: 5 * 60_000,
  });

  const event = eventData?.data;
  const eventId = event?.id ?? "";

  const {
    data: sessionsData,
    isLoading: isLoadingSessions,
    isError: sessionsError,
  } = useQuery({
    queryKey: ["sessions", eventId],
    queryFn: () => sessionsApi.list(eventId),
    enabled: !!eventId,
  });

  const { data: bookmarksData } = useQuery({
    queryKey: ["session-bookmarks", eventId],
    queryFn: () => sessionsApi.getBookmarks(eventId),
    enabled: !!eventId,
  });

  const toggleBookmark = useMutation({
    mutationFn: async ({
      sessionId,
      isBookmarked,
    }: {
      sessionId: string;
      isBookmarked: boolean;
    }) => {
      if (isBookmarked) {
        await sessionsApi.removeBookmark(eventId, sessionId);
      } else {
        await sessionsApi.bookmark(eventId, sessionId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session-bookmarks", eventId] });
    },
  });

  const sessions = sessionsData?.data ?? [];
  const bookmarkedIds = new Set((bookmarksData?.data ?? []).map((b) => b.sessionId));

  if (isLoadingEvent || isLoadingSessions) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessionsError) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker={t("errorKicker")}
          title={t("errorTitle")}
          action={
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["sessions", eventId] })}
              className="text-sm font-medium text-teranga-gold-dark hover:underline"
            >
              {t("retry")}
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <Link
        href={event ? `/events/${event.slug}` : "/events"}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("back")}
      </Link>

      <SectionHeader
        kicker={t("kicker")}
        title={t("title")}
        subtitle={event?.title}
        size="hero"
        as="h1"
      />
      <p className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        — {t("timezone")}
      </p>

      {sessions.length === 0 ? (
        <EmptyStateEditorial
          icon={Calendar}
          kicker={t("emptyKicker")}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => {
            const isBookmarked = bookmarkedIds.has(session.id);
            return (
              <div
                key={session.id}
                className={`bg-card rounded-xl border p-5 transition-colors ${isBookmarked ? "border-primary/30 bg-primary/5" : "border-border"}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground mb-1">{session.title}</h3>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-2">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatTime(session.startTime, regional)} — {formatTime(session.endTime, regional)}
                      </span>
                      {session.location && (
                        <span className="bg-accent text-muted-foreground text-xs px-2 py-0.5 rounded-full">
                          {session.location}
                        </span>
                      )}
                      {session.speakerIds.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Mic className="h-3.5 w-3.5" />
                          {t("speakersCount", { count: session.speakerIds.length })}
                        </span>
                      )}
                    </div>
                    {session.description && (
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {session.description}
                      </p>
                    )}
                  </div>
                  {session.isBookmarkable && (
                    <button
                      onClick={() => toggleBookmark.mutate({ sessionId: session.id, isBookmarked })}
                      className={`p-2 rounded-lg transition-colors ${isBookmarked ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                      title={
                        isBookmarked ? t("removeBookmarkShort") : t("addBookmarkShort")
                      }
                      aria-label={isBookmarked ? t("removeBookmarkAria") : t("addBookmarkAria")}
                    >
                      <Bookmark className={`h-5 w-5 ${isBookmarked ? "fill-current" : ""}`} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
