import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, MapPin, Clock, Users, Tag, ExternalLink } from "lucide-react";
import { serverEventsApi } from "@/lib/server-api";
import { formatDate, formatDateTime, formatCurrency, Badge } from "@teranga/shared-ui";
import { EventJsonLd } from "@/components/event-detail/event-jsonld";
import { ShareButtons } from "@/components/share-buttons";
import { AddToCalendar } from "@/components/add-to-calendar";
import { EventCard } from "@/components/event-card";
import type { Event } from "@teranga/shared-types";
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
    const totalPages = Math.min(
      first.meta.totalPages,
      Math.ceil(MAX_EVENTS / BATCH_SIZE),
    );

    // If there is only one page, return immediately
    if (totalPages <= 1) {
      return first.data.map((event) => ({ slug: event.slug }));
    }

    // Fetch remaining pages in parallel
    const remainingPages = Array.from(
      { length: totalPages - 1 },
      (_, i) => i + 2,
    );
    const rest = await Promise.all(
      remainingPages.map((page) =>
        serverEventsApi.search({ page, limit: BATCH_SIZE }),
      ),
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
      ...(event.coverImageURL ? { images: [{ url: event.coverImageURL, width: 1200, height: 630, alt: event.title }] } : {}),
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

  const similarEvents = await getSimilarEvents(event);

  const visibleTickets = event.ticketTypes.filter((t) => t.isVisible);
  const minPrice = visibleTickets.length > 0 ? Math.min(...visibleTickets.map((t) => t.price)) : null;
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
                <Badge variant="secondary">{CATEGORY_LABELS[event.category] ?? event.category}</Badge>
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
                      {formatDateTime(event.startDate).split(" ").pop()} — {formatDateTime(event.endDate).split(" ").pop()}
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
                    <p className="font-medium text-foreground">{event.location.name}</p>
                    <p className="text-sm">{event.location.address}, {event.location.city}</p>
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
                        <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
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
                      {event.registeredCount} personne{event.registeredCount > 1 ? "s" : ""} inscrite{event.registeredCount > 1 ? "s" : ""}
                    </span>
                  </div>
                  {event.maxAttendees && (
                    <div className="mt-2">
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-teranga-gold transition-all"
                          style={{ width: `${Math.min(100, (event.registeredCount / event.maxAttendees) * 100)}%` }}
                        />
                      </div>
                      {spotsLeft !== null && spotsLeft > 0 && spotsLeft <= event.maxAttendees * 0.2 && (
                        <p className="mt-1 text-xs font-medium text-orange-600">
                          Plus que {spotsLeft} place{spotsLeft > 1 ? "s" : ""} !
                        </p>
                      )}
                    </div>
                  )}
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

              {/* Description */}
              <div className="mt-8">
                <h2 className="text-xl font-semibold">À propos</h2>
                <div className="mt-3 prose prose-sm max-w-none prose-headings:text-foreground prose-headings:font-semibold prose-p:text-muted-foreground prose-p:leading-relaxed prose-a:text-teranga-gold-dark prose-a:underline prose-strong:text-foreground prose-ul:text-muted-foreground prose-ol:text-muted-foreground prose-li:text-muted-foreground">
                  <ReactMarkdown>{event.description}</ReactMarkdown>
                </div>
              </div>
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

                      return (
                        <div
                          key={ticket.id}
                          className={`rounded-md border p-4 ${soldOut ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{ticket.name}</span>
                            <span className="font-semibold text-teranga-gold">
                              {ticket.price === 0 ? "Gratuit" : formatCurrency(ticket.price, ticket.currency)}
                            </span>
                          </div>
                          {ticket.description && (
                            <p className="mt-1 text-xs text-muted-foreground">{ticket.description}</p>
                          )}
                          {remaining !== null && (
                            <p className={`mt-1 text-xs ${soldOut ? "text-destructive" : "text-muted-foreground"}`}>
                              {soldOut ? "Épuisé" : `${remaining} restant${remaining > 1 ? "s" : ""}`}
                            </p>
                          )}
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
                    {isFree ? "S'inscrire gratuitement" : `S'inscrire — à partir de ${formatCurrency(minPrice!)}`}
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
