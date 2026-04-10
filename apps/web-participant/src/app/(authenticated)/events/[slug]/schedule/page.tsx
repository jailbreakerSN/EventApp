"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionsApi, eventsApi } from "@/lib/api-client";
import { Calendar, Clock, Mic, Bookmark, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}

export default function SchedulePage() {
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

  const { data: sessionsData, isLoading: isLoadingSessions } = useQuery({
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href={event ? `/events/${event.slug}` : "/events"}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Retour
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <Calendar className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Programme</h1>
          {event && <p className="text-sm text-muted-foreground">{event.title}</p>}
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Calendar className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg">Aucune session programmée</p>
          <p className="text-sm mt-1">Le programme sera disponible prochainement</p>
        </div>
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
                        {formatTime(session.startTime)} — {formatTime(session.endTime)}
                      </span>
                      {session.location && (
                        <span className="bg-accent text-muted-foreground text-xs px-2 py-0.5 rounded-full">
                          {session.location}
                        </span>
                      )}
                      {session.speakerIds.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Mic className="h-3.5 w-3.5" />
                          {session.speakerIds.length} intervenant(s)
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
                        isBookmarked ? "Retirer du programme perso" : "Ajouter au programme perso"
                      }
                      aria-label={
                        isBookmarked
                          ? "Retirer du programme personnel"
                          : "Ajouter au programme personnel"
                      }
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
