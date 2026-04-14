import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Calendar,
  MapPin,
  Clock,
  Users,
  Tag,
  ExternalLink,
  Building2,
  Mic2,
  Globe,
  Linkedin,
  Twitter,
  MessageSquare,
} from "lucide-react";
import { serverEventsApi, serverSpeakersApi, serverSessionsApi } from "@/lib/server-api";
import { formatDate, formatDateTime, formatCurrency, Badge } from "@teranga/shared-ui";
import { EventJsonLd } from "@/components/event-detail/event-jsonld";
import { EventDetailTabs } from "@/components/event-detail/event-detail-tabs";
import { ShareButtons } from "@/components/share-buttons";
import { AddToCalendar } from "@/components/add-to-calendar";
import { EventCard } from "@/components/event-card";
import type { Event, SpeakerProfile, Session } from "@teranga/shared-types";
import ReactMarkdown from "react-markdown";

export const revalidate = 60;
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getEvent(slug: string): Promise<Event | null> {
  try {
    const result = await serverEventsApi.getBySlug(slug);
    return result.data;
  } catch {
    return null;
  }
}

async function getSpeakers(eventId: string): Promise<SpeakerProfile[]> {
  try {
    const result = await serverSpeakersApi.listByEvent(eventId);
    return result.data;
  } catch {
    return [];
  }
}

async function getSessions(eventId: string): Promise<Session[]> {
  try {
    const result = await serverSessionsApi.listByEvent(eventId);
    return result.data;
  } catch {
    return [];
  }
}

function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Dakar",
  });
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Dakar",
  });
}

function groupSessionsByDate(sessions: Session[]): Map<string, Session[]> {
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
  const groups = new Map<string, Session[]>();
  for (const session of sorted) {
    const dateKey = formatSessionDate(session.startTime);
    const existing = groups.get(dateKey) ?? [];
    existing.push(session);
    groups.set(dateKey, existing);
  }
  return groups;
}

async function getSimilarEvents(event: Event): Promise<Event[]> {
  try {
    // First try: same category + same city
    const result = await serverEventsApi.search({
      category: event.category,
      city: event.location.city,
      limit: 4,
    });
    const filtered = result.data.filter((e) => e.id !== event.id);
    if (filtered.length > 0) return filtered;

    // Fallback: same category only, no city filter
    const broader = await serverEventsApi.search({
      category: event.category,
      limit: 4,
    });
    return broader.data.filter((e) => e.id !== event.id);
  } catch {
    return [];
  }
}

export async function generateStaticParams() {
  const BATCH_SIZE = 100;
  const MAX_EVENTS = 1000;

  try {
    // Fetch the first page to discover total page count
    const first = await serverEventsApi.search({ page: 1, limit: BATCH_SIZE });
    const totalPages = Math.min(first.meta.totalPages, Math.ceil(MAX_EVENTS / BATCH_SIZE));

    // If there is only one page, return immediately
    if (totalPages <= 1) {
      return first.data.map((event) => ({ slug: event.slug }));
    }

    // Fetch remaining pages in parallel
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const rest = await Promise.all(
      remainingPages.map((page) => serverEventsApi.search({ page, limit: BATCH_SIZE })),
    );

    const allEvents = [first, ...rest].flatMap((r) => r.data);
    // Enforce hard cap in case totalPages arithmetic overshoots
    return allEvents.slice(0, MAX_EVENTS).map((event) => ({ slug: event.slug }));
  } catch {
    // If the API is unreachable during build, fall back to on-demand generation
    // via dynamicParams = true (already set above)
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event) return { title: "Événement introuvable" };

  const description = event.shortDescription ?? event.description.slice(0, 160);

  return {
    title: event.title,
    description,
    openGraph: {
      title: event.title,
      description,
      type: "website",
      locale: "fr_SN",
      ...(event.coverImageURL
        ? { images: [{ url: event.coverImageURL, width: 1200, height: 630, alt: event.title }] }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: event.title,
      description,
      ...(event.coverImageURL ? { images: [event.coverImageURL] } : {}),
    },
  };
}

const FORMAT_LABELS: Record<string, string> = {
  in_person: "Présentiel",
  online: "En ligne",
  hybrid: "Hybride",
};

const CATEGORY_LABELS: Record<string, string> = {
  conference: "Conférence",
  workshop: "Atelier",
  concert: "Concert",
  festival: "Festival",
  networking: "Networking",
  sport: "Sport",
  exhibition: "Exposition",
  ceremony: "Cérémonie",
  training: "Formation",
  other: "Autre",
};

export default async function EventDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event) notFound();

  const [speakers, sessions, similarEvents] = await Promise.all([
    getSpeakers(event.id),
    getSessions(event.id),
    getSimilarEvents(event),
  ]);

  const speakerMap = new Map(speakers.map((s) => [s.id, s]));
  const sessionsByDate = groupSessionsByDate(sessions);

  const visibleTickets = event.ticketTypes.filter((t) => t.isVisible);
  const minPrice =
    visibleTickets.length > 0 ? Math.min(...visibleTickets.map((t) => t.price)) : null;
  const isFree = minPrice === 0 || minPrice === null;

  const spotsLeft = event.maxAttendees
    ? Math.max(0, event.maxAttendees - event.registeredCount)
    : null;

  return (
    <>
      <EventJsonLd event={event} />

      {/* Cover image */}
      <div className="relative h-64 bg-teranga-navy sm:h-80 lg:h-96">
        {event.coverImageURL ? (
          <Image
            src={event.coverImageURL}
            alt={event.title}
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-teranga-navy to-teranga-navy/80">
            <span className="text-6xl font-bold text-teranga-gold">{event.title.charAt(0)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative -mt-16 grid gap-8 lg:grid-cols-3">
          {/* Main content */}
          <div className="lg:col-span-2">
            <div className="rounded-lg bg-card p-6 shadow-lg">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {CATEGORY_LABELS[event.category] ?? event.category}
                </Badge>
                <Badge variant="outline">{FORMAT_LABELS[event.format] ?? event.format}</Badge>
                {event.isFeatured && <Badge variant="warning">À la une</Badge>}
              </div>

              <h1 className="mt-4 text-3xl font-bold text-foreground sm:text-4xl">{event.title}</h1>

              {/* Date & time */}
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Calendar className="h-5 w-5 flex-shrink-0 text-teranga-gold" />
                  <div>
                    <p className="font-medium text-foreground">{formatDate(event.startDate)}</p>
                    <p className="text-sm">
                      {formatDateTime(event.startDate).split(" ").pop()} —{" "}
                      {formatDateTime(event.endDate).split(" ").pop()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-muted-foreground">
                  <Clock className="h-5 w-5 flex-shrink-0 text-teranga-gold" />
                  <span className="text-sm">Fuseau : {event.timezone}</span>
                </div>

                {/* Location */}
                <div className="flex items-start gap-3 text-muted-foreground">
                  <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-teranga-gold" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{event.location.name}</p>
                      {event.venueId && (
                        <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0.5">
                          <Building2 className="h-3 w-3" aria-hidden="true" />
                          Lieu référencé
                        </Badge>
                      )}
                    </div>
                    {event.venueName && event.venueName !== event.location.name && (
                      <p className="text-sm text-foreground/80">{event.venueName}</p>
                    )}
                    <p className="text-sm">
                      {event.location.address}, {event.location.city}
                    </p>
                    {event.location.googleMapsUrl && (
                      <a
                        href={event.location.googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm text-teranga-gold-dark hover:underline"
                      >
                        Voir sur Google Maps <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>

                {spotsLeft !== null && (
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Users className="h-5 w-5 flex-shrink-0 text-teranga-gold" />
                    <span className="text-sm">
                      {spotsLeft > 0
                        ? `${spotsLeft} place${spotsLeft > 1 ? "s" : ""} restante${spotsLeft > 1 ? "s" : ""}`
                        : "Complet"}
                    </span>
                  </div>
                )}

                {event.tags.length > 0 && (
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Tag className="h-5 w-5 flex-shrink-0 text-teranga-gold" />
                    <div className="flex flex-wrap gap-1">
                      {event.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Social proof */}
              {event.registeredCount > 0 && (
                <div className="mt-6 rounded-md bg-muted/50 p-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-teranga-gold" />
                    <span className="font-semibold">
                      {event.registeredCount} personne{event.registeredCount > 1 ? "s" : ""}{" "}
                      inscrite{event.registeredCount > 1 ? "s" : ""}
                    </span>
                  </div>
                  {event.maxAttendees &&
                    (() => {
                      const pct = Math.min(100, (event.registeredCount / event.maxAttendees) * 100);
                      const isFull = pct >= 100;
                      const barColor = isFull
                        ? "bg-red-500"
                        : pct >= 90
                          ? "bg-red-500"
                          : pct >= 70
                            ? "bg-amber-500"
                            : "bg-green-500";
                      return (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-muted-foreground">
                              {event.registeredCount} / {event.maxAttendees} places
                            </span>
                            {isFull ? (
                              <Badge variant="destructive">Complet</Badge>
                            ) : (
                              <span
                                className={`text-xs font-medium ${pct >= 90 ? "text-red-600 dark:text-red-400" : pct >= 70 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                              >
                                {Math.round(pct)}%
                              </span>
                            )}
                          </div>
                          <div className="h-2 w-full rounded-full bg-muted">
                            <div
                              className={`h-2 rounded-full ${barColor} transition-all`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          {spotsLeft !== null &&
                            spotsLeft > 0 &&
                            spotsLeft <= event.maxAttendees * 0.2 && (
                              <p className="mt-1 text-xs font-medium text-orange-600">
                                Plus que {spotsLeft} place{spotsLeft > 1 ? "s" : ""} !
                              </p>
                            )}
                        </div>
                      );
                    })()}
                </div>
              )}

              {/* Share buttons */}
              <div className="mt-6">
                <ShareButtons
                  title={event.title}
                  date={formatDate(event.startDate)}
                  url={`${process.env.NEXT_PUBLIC_APP_URL || "https://teranga.sn"}/events/${event.slug}`}
                  description={event.shortDescription ?? undefined}
                />
              </div>

              {/* Tabbed sections — about / speakers / sessions */}
              <EventDetailTabs
                about={
                  <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-headings:font-semibold prose-p:text-muted-foreground prose-p:leading-relaxed prose-a:text-teranga-gold-dark prose-a:underline prose-strong:text-foreground prose-ul:text-muted-foreground prose-ol:text-muted-foreground prose-li:text-muted-foreground">
                    <ReactMarkdown>{event.description}</ReactMarkdown>
                  </div>
                }
                speakers={
                  speakers.length > 0 ? (
                    <div>
                  <div className="sr-only">
                    <Mic2 className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
                    <h2 className="text-xl font-semibold">Intervenants</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {speakers.map((speaker) => (
                      <div
                        key={speaker.id}
                        className="rounded-lg border border-border bg-muted/30 p-4"
                      >
                        <div className="flex items-start gap-3">
                          {speaker.photoURL ? (
                            <Image
                              src={speaker.photoURL}
                              alt={speaker.name}
                              width={48}
                              height={48}
                              className="h-12 w-12 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-teranga-gold/10 text-teranga-gold font-semibold text-lg">
                              {speaker.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground truncate">{speaker.name}</p>
                            {(speaker.title || speaker.company) && (
                              <p className="text-sm text-muted-foreground truncate">
                                {[speaker.title, speaker.company].filter(Boolean).join(" — ")}
                              </p>
                            )}
                          </div>
                        </div>
                        {speaker.bio && (
                          <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                            {speaker.bio}
                          </p>
                        )}
                        {speaker.topics.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {speaker.topics.slice(0, 3).map((topic) => (
                              <Badge key={topic} variant="outline" className="text-xs">
                                {topic}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {speaker.socialLinks && (
                          <div className="mt-3 flex items-center gap-2">
                            {speaker.socialLinks.twitter && (
                              <a
                                href={speaker.socialLinks.twitter}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Twitter de ${speaker.name}`}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Twitter className="h-4 w-4" />
                              </a>
                            )}
                            {speaker.socialLinks.linkedin && (
                              <a
                                href={speaker.socialLinks.linkedin}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`LinkedIn de ${speaker.name}`}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Linkedin className="h-4 w-4" />
                              </a>
                            )}
                            {speaker.socialLinks.website && (
                              <a
                                href={speaker.socialLinks.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Site web de ${speaker.name}`}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Globe className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                  ) : null
                }
                sessions={
                  sessions.length > 0 ? (
                    <div>
                  <div className="sr-only">
                    <Calendar className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
                    <h2 className="text-xl font-semibold">Programme</h2>
                  </div>
                  <div className="space-y-6">
                    {Array.from(sessionsByDate.entries()).map(([dateLabel, daySessions]) => (
                      <div key={dateLabel}>
                        {sessionsByDate.size > 1 && (
                          <h3 className="text-sm font-semibold text-teranga-gold uppercase tracking-wide mb-3">
                            {dateLabel}
                          </h3>
                        )}
                        <div className="space-y-3">
                          {daySessions.map((session) => {
                            const sessionSpeakers = session.speakerIds
                              .map((id) => speakerMap.get(id))
                              .filter(Boolean) as SpeakerProfile[];
                            return (
                              <div
                                key={session.id}
                                className="flex gap-4 rounded-lg border border-border bg-muted/30 p-4"
                              >
                                <div className="flex-shrink-0 text-right w-24">
                                  <p className="text-sm font-semibold text-foreground">
                                    {formatSessionTime(session.startTime)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatSessionTime(session.endTime)}
                                  </p>
                                </div>
                                <div className="h-auto w-px bg-teranga-gold/30 flex-shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-foreground">{session.title}</p>
                                  {sessionSpeakers.length > 0 && (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      {sessionSpeakers.map((s) => s.name).join(", ")}
                                    </p>
                                  )}
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {session.location && (
                                      <Badge variant="outline" className="text-xs gap-1">
                                        <MapPin className="h-3 w-3" aria-hidden="true" />
                                        {session.location}
                                      </Badge>
                                    )}
                                    {session.tags.map((tag) => (
                                      <Badge key={tag} variant="secondary" className="text-xs">
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                  {session.description && (
                                    <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                                      {session.description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                  ) : null
                }
              />
            </div>
          </div>

          {/* Sidebar — Tickets & CTA */}
          <div className="lg:col-span-1">
            <div className="sticky top-20 space-y-4">
              <div className="rounded-lg bg-card p-6 shadow-lg">
                <h2 className="text-lg font-semibold">Billets</h2>

                {visibleTickets.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">Aucun billet disponible.</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {visibleTickets.map((ticket) => {
                      const remaining = ticket.totalQuantity
                        ? ticket.totalQuantity - ticket.soldCount
                        : null;
                      const soldOut = remaining !== null && remaining <= 0;
                      const ticketPct = ticket.totalQuantity
                        ? Math.min(100, (ticket.soldCount / ticket.totalQuantity) * 100)
                        : null;
                      const ticketBarColor =
                        ticketPct === null
                          ? ""
                          : ticketPct >= 100
                            ? "bg-red-500"
                            : ticketPct >= 90
                              ? "bg-red-500"
                              : ticketPct >= 70
                                ? "bg-amber-500"
                                : "bg-green-500";

                      return (
                        <div
                          key={ticket.id}
                          className={`rounded-md border p-4 ${soldOut ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{ticket.name}</span>
                            <span className="font-semibold text-teranga-gold">
                              {ticket.price === 0
                                ? "Gratuit"
                                : formatCurrency(ticket.price, ticket.currency)}
                            </span>
                          </div>
                          {ticket.description && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {ticket.description}
                            </p>
                          )}
                          {ticket.totalQuantity ? (
                            <div className="mt-2">
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-muted-foreground">
                                  {ticket.soldCount} / {ticket.totalQuantity} places
                                </span>
                                {soldOut ? (
                                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                    Complet
                                  </Badge>
                                ) : (
                                  <span
                                    className={`font-medium ${ticketPct !== null && ticketPct >= 90 ? "text-red-600 dark:text-red-400" : ticketPct !== null && ticketPct >= 70 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                                  >
                                    {remaining} restant
                                    {remaining !== null && remaining > 1 ? "s" : ""}
                                  </span>
                                )}
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-muted">
                                <div
                                  className={`h-1.5 rounded-full ${ticketBarColor} transition-all`}
                                  style={{ width: `${ticketPct ?? 0}%` }}
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-6">
                  <Link
                    href={`/register/${event.id}`}
                    className="block w-full rounded-lg bg-teranga-gold py-3 text-center text-base font-semibold text-white transition-colors hover:bg-teranga-gold/90"
                  >
                    {isFree
                      ? "S'inscrire gratuitement"
                      : `S'inscrire — à partir de ${formatCurrency(minPrice!)}`}
                  </Link>
                  {event.requiresApproval && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Inscription soumise à approbation de l&apos;organisateur.
                    </p>
                  )}
                </div>
              </div>

              {/* Add to Calendar */}
              <div className="rounded-lg bg-card p-6 shadow-lg">
                <h3 className="text-sm font-semibold mb-3">Ajouter au calendrier</h3>
                <AddToCalendar
                  title={event.title}
                  description={event.shortDescription ?? event.description.slice(0, 300)}
                  location={`${event.location.name}, ${event.location.address}, ${event.location.city}`}
                  startDate={event.startDate}
                  endDate={event.endDate}
                />
              </div>

              {/* Feed communautaire */}
              <Link
                href={`/events/${event.slug}/feed`}
                className="flex items-center gap-3 rounded-lg bg-card p-6 shadow-lg hover:shadow-md transition-shadow group"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <MessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold group-hover:text-primary transition-colors">
                    Feed communautaire
                  </h3>
                  <p className="text-xs text-muted-foreground">Échangez avec les participants</p>
                </div>
              </Link>

              {/* Online event link */}
              {event.location.streamUrl && (
                <div className="rounded-lg bg-card p-6 shadow-lg">
                  <h3 className="text-sm font-semibold">Événement en ligne</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Le lien d&apos;accès sera partagé après inscription.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {similarEvents.length > 0 && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-16">
          <h2 className="text-2xl font-bold text-foreground mb-6">Événements similaires</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {similarEvents.map((similar) => (
              <EventCard key={similar.id} event={similar} />
            ))}
          </div>
        </div>
      )}

      <div className="h-16" />
    </>
  );
}
