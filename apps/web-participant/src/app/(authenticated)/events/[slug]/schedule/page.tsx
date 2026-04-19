"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionsApi, eventsApi } from "@/lib/api-client";
import {
  Calendar,
  Clock,
  MapPin,
  Mic,
  Bookmark,
  Loader2,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import { EmptyStateEditorial, SectionHeader } from "@teranga/shared-ui";
import Link from "next/link";
import type { Session } from "@teranga/shared-types";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Dakar",
  });
}

function formatDayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Dakar",
  });
}

function groupByDay(sessions: Session[]): Map<string, Session[]> {
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
  const map = new Map<string, Session[]>();
  for (const s of sorted) {
    const key = formatDayLabel(s.startTime);
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return map;
}

function durationLabel(start: string, end: string) {
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export default function SchedulePage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();

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
  const sessionsByDay = groupByDay(sessions);
  const hasMultipleDays = sessionsByDay.size > 1;

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
          kicker="— ERREUR"
          title="Impossible de charger le programme"
          action={
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["sessions", eventId] })}
              className="text-sm font-medium text-teranga-gold-dark hover:underline"
            >
              Réessayer
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <Link
        href={event ? `/events/${event.slug}` : "/events"}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Retour
      </Link>

      <SectionHeader
        kicker="— PROGRAMME"
        title="Programme"
        subtitle={event?.title}
        size="hero"
        as="h1"
      />

      {/* Bookmark count strip */}
      {bookmarkedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-full border border-teranga-gold/30 bg-teranga-gold/5 px-4 py-2 text-sm">
          <Bookmark className="h-4 w-4 fill-teranga-gold text-teranga-gold" aria-hidden="true" />
          <span className="text-foreground">
            <strong>{bookmarkedIds.size}</strong>{" "}
            {bookmarkedIds.size === 1
              ? "session dans votre programme"
              : "sessions dans votre programme"}
          </span>
        </div>
      )}

      {sessions.length === 0 ? (
        <EmptyStateEditorial
          icon={Calendar}
          kicker="— AUCUNE SESSION"
          title="Aucune session programmée"
          description="Le programme sera disponible prochainement. Revenez bientôt."
        />
      ) : (
        <div className="space-y-10">
          {Array.from(sessionsByDay.entries()).map(([dayLabel, daySessions]) => (
            <section key={dayLabel}>
              {/* Day header — only if multi-day event */}
              {hasMultipleDays && (
                <div className="mb-4 flex items-center gap-3">
                  <p className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.14em] text-teranga-gold-dark capitalize">
                    — {dayLabel}
                  </p>
                  <div className="flex-1 border-t border-dashed" aria-hidden="true" />
                </div>
              )}

              {/* Timeline */}
              <div className="relative">
                {/* Vertical time rail */}
                <div
                  className="absolute left-[52px] top-2 bottom-2 w-px bg-border"
                  aria-hidden="true"
                />

                <div className="space-y-3">
                  {daySessions.map((session) => {
                    const isBookmarked = bookmarkedIds.has(session.id);
                    const duration = durationLabel(session.startTime, session.endTime);
                    return (
                      <div key={session.id} className="flex gap-4">
                        {/* Time column */}
                        <div className="w-[52px] shrink-0 pt-3.5 text-right">
                          <span className="font-mono-kicker text-[11px] font-semibold text-teranga-navy dark:text-teranga-gold">
                            {formatTime(session.startTime)}
                          </span>
                        </div>

                        {/* Timeline dot */}
                        <div className="relative flex shrink-0 flex-col items-center pt-4">
                          <span
                            className={`z-10 h-2.5 w-2.5 rounded-full border-2 ${
                              isBookmarked
                                ? "border-teranga-gold bg-teranga-gold"
                                : "border-border bg-card"
                            }`}
                            aria-hidden="true"
                          />
                        </div>

                        {/* Session card */}
                        <div
                          className={`mb-1 flex-1 rounded-card border p-4 transition-colors ${
                            isBookmarked
                              ? "border-teranga-gold/40 bg-teranga-gold/5"
                              : "bg-card hover:border-muted-foreground/30"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-foreground leading-snug">
                                {session.title}
                              </h3>

                              {/* Meta row */}
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" aria-hidden="true" />
                                  {formatTime(session.startTime)} — {formatTime(session.endTime)}
                                  <span className="text-muted-foreground/60">({duration})</span>
                                </span>
                                {session.location && (
                                  <span className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" aria-hidden="true" />
                                    {session.location}
                                  </span>
                                )}
                                {session.speakerIds.length > 0 && (
                                  <span className="flex items-center gap-1">
                                    <Mic className="h-3 w-3" aria-hidden="true" />
                                    {session.speakerIds.length}{" "}
                                    {session.speakerIds.length === 1
                                      ? "intervenant"
                                      : "intervenants"}
                                  </span>
                                )}
                              </div>

                              {session.description && (
                                <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                                  {session.description}
                                </p>
                              )}

                              {/* Tags */}
                              {session.tags.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {session.tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Bookmark button */}
                            {session.isBookmarkable && (
                              <button
                                onClick={() =>
                                  toggleBookmark.mutate({ sessionId: session.id, isBookmarked })
                                }
                                className={`shrink-0 rounded-lg p-2 transition-colors ${
                                  isBookmarked
                                    ? "text-teranga-gold hover:bg-teranga-gold/10"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                }`}
                                aria-label={
                                  isBookmarked
                                    ? "Retirer du programme personnel"
                                    : "Ajouter au programme personnel"
                                }
                                title={
                                  isBookmarked
                                    ? "Retirer du programme perso"
                                    : "Ajouter au programme perso"
                                }
                              >
                                <Bookmark
                                  className={`h-4 w-4 ${isBookmarked ? "fill-current" : ""}`}
                                />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
