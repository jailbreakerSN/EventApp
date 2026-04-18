import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MapPin,
  ExternalLink,
  Building2,
  Globe,
  Linkedin,
  Twitter,
  MessageSquare,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { serverEventsApi, serverSpeakersApi, serverSessionsApi } from "@/lib/server-api";
import {
  CapacityBar,
  EditorialEventCard,
  EditorialHero,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@teranga/shared-ui";
import { EventJsonLd } from "@/components/event-detail/event-jsonld";
import { ShareButtons } from "@/components/share-buttons";
import { SaveEventButton } from "@/components/save-event-button";
import { AddToCalendar } from "@/components/add-to-calendar";
import { mapEventToEditorialCardProps } from "@/lib/editorial-card-props";
import { getCoverGradient } from "@/lib/cover-gradient";
import { intlLocale } from "@/lib/intl-locale";
import type { Event, SpeakerProfile, Session } from "@teranga/shared-types";
import ReactMarkdown from "react-markdown";
import { getLocale, getTranslations } from "next-intl/server";

// The root layout reads the NEXT_LOCALE cookie via next-intl's getLocale() /
// getMessages(), which means any page under it inherently requires dynamic
// rendering. Declaring `revalidate` + `generateStaticParams` on top of that
// put Next.js 15 into ISR mode at runtime and the subsequent cookie read
// during background revalidation threw DYNAMIC_SERVER_USAGE → 500 on
// /events/[slug]. Explicitly marking the route dynamic matches the real
// rendering model and eliminates the crash.
export const dynamic = "force-dynamic";

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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [event, tDetail, locale] = await Promise.all([
    getEvent(slug),
    getTranslations("events.detail"),
    getLocale(),
  ]);
  if (!event) return { title: tDetail("notFound") };

  const description = event.shortDescription ?? event.description.slice(0, 160);
  const ogLocale = locale === "en" ? "en_US" : locale === "wo" ? "wo_SN" : "fr_SN";

  return {
    title: event.title,
    description,
    openGraph: {
      title: event.title,
      description,
      type: "website",
      locale: ogLocale,
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

export default async function EventDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event) notFound();

  const [
    speakers,
    sessions,
    similarEvents,
    locale,
    tDetail,
    tCommon,
    tCategories,
    tFormat,
    tEventsCard,
  ] = await Promise.all([
    getSpeakers(event.id),
    getSessions(event.id),
    getSimilarEvents(event),
    getLocale(),
    getTranslations("events.detail"),
    getTranslations("common"),
    getTranslations("categories"),
    getTranslations("format"),
    getTranslations("events.card"),
  ]);
  const regional = intlLocale(locale);

  const speakerMap = new Map(speakers.map((s) => [s.id, s]));
  const sessionsByDate = groupSessionsByDate(sessions);

  const visibleTickets = event.ticketTypes.filter((t) => t.isVisible);
  const minPrice =
    visibleTickets.length > 0 ? Math.min(...visibleTickets.map((t) => t.price)) : null;
  const isFree = minPrice === 0 || minPrice === null;

  const spotsLeft = event.maxAttendees
    ? Math.max(0, event.maxAttendees - event.registeredCount)
    : null;

  const capacityPct =
    event.maxAttendees && event.maxAttendees > 0
      ? Math.min(100, Math.round((event.registeredCount / event.maxAttendees) * 100))
      : null;
  const isFull = capacityPct !== null && capacityPct >= 100;
  const venueShortName = event.location.name.split(",")[0];
  const startTime = formatDateTime(event.startDate, regional).split(" ").pop();
  const endTime = formatDateTime(event.endDate, regional).split(" ").pop();

  return (
    <>
      <EventJsonLd event={event} />

      {/* Back bar — thin strip modelled on the prototype's
          "Tous les événements" top chrome. Keeps share/save close to
          the headline without competing for attention with the hero. */}
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3.5 lg:px-8">
          <Link
            href="/events"
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {tDetail("allEvents")}
          </Link>
          <div className="flex items-center gap-1">
            <SaveEventButton eventId={event.id} />
            <ShareButtons
              title={event.title}
              date={formatDate(event.startDate, regional)}
              url={`${process.env.NEXT_PUBLIC_APP_URL || "https://teranga.sn"}/events/${event.slug}`}
              description={event.shortDescription ?? undefined}
            />
          </div>
        </div>
      </div>

      {/* Editorial hero — 440px navy cover with pills, Fraunces serif
          title and tagline. Matches prototype event-detail.jsx.
          Uses shared-ui EditorialHero (navy variant) with an injected
          backgroundNode so the event cover image (or fallback gradient)
          sits under the texture overlay. */}
      <EditorialHero
        variant="navy"
        className="teranga-cover w-full"
        style={event.coverImageURL ? undefined : { background: getCoverGradient(event.id).bg }}
        backgroundNode={
          event.coverImageURL ? (
            <Image
              src={event.coverImageURL}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
          ) : null
        }
        pills={
          <>
            <span className="inline-flex items-center rounded-full bg-teranga-gold px-3 py-1 text-xs font-semibold text-teranga-navy">
              {tCategories(event.category as "conference")}
            </span>
            {event.venueId && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                <Building2 className="h-3 w-3" aria-hidden="true" />
                {tDetail("venueReferenced")}
              </span>
            )}
            {spotsLeft !== null &&
              spotsLeft > 0 &&
              event.maxAttendees &&
              spotsLeft <= event.maxAttendees * 0.15 && (
                <span className="inline-flex items-center rounded-full bg-teranga-clay px-3 py-1 text-xs font-semibold text-white">
                  ⚠ {tDetail("lastSeats", { count: spotsLeft })}
                </span>
              )}
            {/* Popular signal — fires at 70%+ capacity but stops once the
                "last seats" urgency pill above has taken over, so the two
                are mutually exclusive from the participant's point of view. */}
            {capacityPct !== null &&
              capacityPct >= 70 &&
              spotsLeft !== null &&
              event.maxAttendees &&
              spotsLeft > event.maxAttendees * 0.15 &&
              !isFull && (
                <span className="inline-flex items-center rounded-full bg-teranga-gold/15 px-3 py-1 text-xs font-semibold text-teranga-gold-dark dark:bg-teranga-gold/25">
                  ✦ {tDetail("popular")}
                </span>
              )}
            {isFull && (
              <span className="inline-flex items-center rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-white">
                {tDetail("full")}
              </span>
            )}
          </>
        }
        title={event.title}
        lead={event.shortDescription ?? undefined}
      />

      {/* Body grid: 1fr / 380px — matches prototype's asymmetric layout. */}
      <div className="mx-auto grid max-w-7xl gap-10 px-6 pb-20 pt-12 lg:grid-cols-[1fr_380px] lg:gap-14 lg:px-8 lg:pt-14">
        <main>
          {/* Meta row — 4 columns divided by vertical rules. */}
          <dl className="mb-12 grid grid-cols-2 gap-y-5 border-y py-6 md:grid-cols-4 md:divide-x md:gap-y-0">
            <MetaCell label={tDetail("meta.dates")}>
              {formatDate(event.startDate, regional)}
            </MetaCell>
            <MetaCell label={tDetail("meta.times")}>
              {startTime} — {endTime}
            </MetaCell>
            <MetaCell label={tDetail("meta.location")}>
              <span className="flex items-baseline gap-1.5">
                <span>{event.location.city}</span>
                <span className="text-muted-foreground">· {venueShortName}</span>
              </span>
              {event.location.googleMapsUrl && (
                <a
                  href={event.location.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-teranga-gold-dark hover:underline"
                >
                  {tDetail("seeOnMaps")}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </MetaCell>
            <MetaCell label={tDetail("meta.format")}>
              {tFormat(event.format as "in_person")}
            </MetaCell>
          </dl>

          {/* About — inlined, no tabs. Editorial serif heading. */}
          <section className="mb-12">
            <h2 className="font-serif-display mb-5 text-[28px] font-semibold tracking-[-0.02em]">
              {tDetail("about")}
            </h2>
            <div className="prose prose-neutral max-w-none text-[17px] leading-[1.65] text-foreground/80 prose-headings:font-serif-display prose-headings:font-semibold prose-headings:tracking-[-0.015em] prose-headings:text-foreground prose-p:text-foreground/80 prose-a:text-teranga-gold-dark prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground dark:prose-invert">
              <ReactMarkdown>{event.description}</ReactMarkdown>
            </div>
            {event.tags.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {event.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Programme — grouped day cards with mono day kicker. */}
          {sessions.length > 0 && (
            <section className="mb-12">
              <h2 className="font-serif-display mb-1.5 text-[28px] font-semibold tracking-[-0.02em]">
                {tDetail("schedule")}
              </h2>
              <p className="font-mono-kicker mb-6 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                — {tDetail("scheduleTimezone")}
              </p>
              <div className="flex flex-col gap-8">
                {Array.from(sessionsByDate.entries()).map(([dateLabel, daySessions]) => (
                  <div key={dateLabel}>
                    {sessionsByDate.size > 1 && (
                      <p className="font-mono-kicker mb-3.5 text-[11px] font-medium uppercase tracking-[0.14em] text-teranga-gold-dark">
                        — {dateLabel}
                      </p>
                    )}
                    <div className="overflow-hidden rounded-card border bg-card">
                      {daySessions.map((session, i) => {
                        const sessionSpeakers = session.speakerIds
                          .map((id) => speakerMap.get(id))
                          .filter(Boolean) as SpeakerProfile[];
                        return (
                          <div
                            key={session.id}
                            className={`grid items-center gap-5 px-5 py-4 md:grid-cols-[110px_1fr_auto] md:px-6 ${
                              i > 0 ? "border-t" : ""
                            }`}
                          >
                            <span className="font-mono-kicker text-sm font-semibold text-teranga-navy dark:text-teranga-gold">
                              {formatSessionTime(session.startTime)}
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">{session.title}</p>
                              {session.description && (
                                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                                  {session.description}
                                </p>
                              )}
                              {(session.location || session.tags.length > 0) && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  {session.location && (
                                    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                                      <MapPin className="h-3 w-3" aria-hidden="true" />
                                      {session.location}
                                    </span>
                                  )}
                                  {session.tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="inline-flex items-center rounded-full bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <span className="text-sm text-muted-foreground md:text-right">
                              {sessionSpeakers.length > 0
                                ? sessionSpeakers.map((s) => s.name).join(", ")
                                : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Intervenants — gradient-avatar grid from the prototype. */}
          {speakers.length > 0 && (
            <section className="mb-12">
              <h2 className="font-serif-display mb-6 text-[28px] font-semibold tracking-[-0.02em]">
                {tDetail("speakers")}
              </h2>
              <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 lg:grid-cols-4">
                {speakers.map((speaker, i) => (
                  <article
                    key={speaker.id}
                    className="rounded-card border bg-card p-5 transition-colors hover:border-muted-foreground/30"
                  >
                    {speaker.photoURL ? (
                      <Image
                        src={speaker.photoURL}
                        alt=""
                        width={54}
                        height={54}
                        className="h-[54px] w-[54px] rounded-full object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="font-serif-display flex h-[54px] w-[54px] items-center justify-center rounded-full text-xl font-semibold text-white"
                        style={{
                          background: SPEAKER_GRADIENTS[i % SPEAKER_GRADIENTS.length],
                        }}
                      >
                        {speaker.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                    )}
                    <p className="mt-3.5 text-sm font-semibold text-foreground">{speaker.name}</p>
                    {(speaker.title || speaker.company) && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {[speaker.title, speaker.company].filter(Boolean).join(" — ")}
                      </p>
                    )}
                    {speaker.socialLinks && (
                      <div className="mt-3 flex items-center gap-2">
                        {speaker.socialLinks.twitter && (
                          <a
                            href={speaker.socialLinks.twitter}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={tDetail("speakerTwitter", { name: speaker.name })}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Twitter className="h-4 w-4" />
                          </a>
                        )}
                        {speaker.socialLinks.linkedin && (
                          <a
                            href={speaker.socialLinks.linkedin}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={tDetail("speakerLinkedin", { name: speaker.name })}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Linkedin className="h-4 w-4" />
                          </a>
                        )}
                        {speaker.socialLinks.website && (
                          <a
                            href={speaker.socialLinks.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={tDetail("speakerWebsite", { name: speaker.name })}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Globe className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Online event notice */}
          {event.location.streamUrl && (
            <section className="mb-12 rounded-card border bg-card p-6">
              <h3 className="font-serif-display text-lg font-semibold tracking-[-0.015em]">
                {tDetail("onlineEvent")}
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{tDetail("onlineHint")}</p>
            </section>
          )}
        </main>

        {/* Editorial sticky sidebar. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-tile border bg-card">
            {/* Price header — kicker + serif price on left, inscrits stat right */}
            <div className="border-b px-6 pb-5 pt-6">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {tDetail("pricing.from")}
                  </p>
                  <p className="font-serif-display mt-1 text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                    {isFree ? tCommon("free") : formatCurrency(minPrice!, "XOF", regional)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {tDetail("pricing.attendees")}
                  </p>
                  <p className="mt-1 flex items-center justify-end gap-1.5 text-lg font-semibold tabular-nums">
                    {event.registeredCount.toLocaleString("fr-FR").replace(/,/g, " ")}
                    <span
                      aria-hidden="true"
                      className="inline-block h-1.5 w-1.5 rounded-full bg-teranga-green teranga-pulse-dot"
                    />
                  </p>
                </div>
              </div>

              {event.maxAttendees && (
                <CapacityBar
                  className="mt-5"
                  registered={event.registeredCount}
                  capacity={event.maxAttendees}
                  percentLabel={tDetail("pricing.percentFull", { pct: capacityPct ?? 0 })}
                  seatsLabel={
                    spotsLeft !== null && spotsLeft > 0
                      ? tDetail("pricing.seatsRemaining", { count: spotsLeft })
                      : tDetail("full")
                  }
                />
              )}
            </div>

            {/* Tickets list */}
            {visibleTickets.length === 0 ? (
              <p className="px-6 py-5 text-sm text-muted-foreground">{tDetail("noTickets")}</p>
            ) : (
              <ul className="flex flex-col gap-2 px-4 pt-4">
                {visibleTickets.map((ticket) => {
                  const remaining = ticket.totalQuantity
                    ? ticket.totalQuantity - ticket.soldCount
                    : null;
                  const soldOut = remaining !== null && remaining <= 0;
                  const ticketBody = (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{ticket.name}</p>
                          {ticket.description && (
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                              {ticket.description}
                            </p>
                          )}
                        </div>
                        <p className="shrink-0 text-[15px] font-bold tabular-nums">
                          {ticket.price === 0
                            ? tCommon("free")
                            : formatCurrency(ticket.price, ticket.currency, regional)}
                        </p>
                      </div>
                      {remaining !== null && remaining > 0 && remaining < 20 && (
                        <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-teranga-clay">
                          <span
                            aria-hidden="true"
                            className="inline-block h-1 w-1 rounded-full bg-teranga-clay"
                          />
                          {tDetail("pricing.onlyLeft", { count: remaining })}
                        </p>
                      )}
                      {soldOut && (
                        <p className="mt-2.5 text-[11px] font-medium text-muted-foreground">
                          {tDetail("soldOut")}
                        </p>
                      )}
                    </>
                  );
                  return (
                    <li key={ticket.id}>
                      {soldOut ? (
                        <div
                          aria-disabled="true"
                          className="block rounded-card border p-4 opacity-50"
                        >
                          {ticketBody}
                        </div>
                      ) : (
                        <Link
                          href={`/register/${event.id}?ticket=${ticket.id}`}
                          className="block rounded-card border p-4 transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold"
                        >
                          {ticketBody}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="px-4 pb-5 pt-4">
              <Link
                href={`/register/${event.id}`}
                className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors ${
                  isFull
                    ? "pointer-events-none cursor-not-allowed bg-muted text-muted-foreground"
                    : "bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
                }`}
                aria-disabled={isFull}
              >
                {isFull
                  ? tDetail("full")
                  : isFree
                    ? tDetail("registerFree")
                    : tDetail("ctaRegister")}
                {!isFull && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </Link>
              <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
                {tDetail("pricing.paymentSecured")}
              </p>
              {event.requiresApproval && (
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  {tDetail("approvalRequired")}
                </p>
              )}
            </div>
          </div>

          {/* Add-to-calendar + feed — kept outside the main pass card
              so the sticky element stays focused on conversion. */}
          <div className="mt-4 rounded-card border bg-card p-5">
            <p className="font-mono-kicker mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {tDetail("addToCalendar")}
            </p>
            <AddToCalendar
              title={event.title}
              description={event.shortDescription ?? event.description.slice(0, 300)}
              location={`${event.location.name}, ${event.location.address}, ${event.location.city}`}
              startDate={event.startDate}
              endDate={event.endDate}
            />
          </div>

          <Link
            href={`/events/${event.slug}/feed`}
            className="group mt-4 flex items-center gap-3 rounded-card border bg-card p-5 transition-shadow hover:shadow-md"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teranga-gold/10"
            >
              <MessageSquare className="h-5 w-5 text-teranga-gold-dark" />
            </span>
            <span>
              <span className="block text-sm font-semibold transition-colors group-hover:text-teranga-gold-dark">
                {tDetail("feedCommunity")}
              </span>
              <span className="block text-xs text-muted-foreground">{tDetail("feedHint")}</span>
            </span>
          </Link>
        </aside>
      </div>

      {/* Similar events — editorial card grid. */}
      {similarEvents.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 pb-16 lg:px-8">
          <h2 className="font-serif-display mb-8 text-3xl font-semibold tracking-[-0.02em]">
            {tDetail("similarEvents")}
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {similarEvents.map((similar, i) => (
              <EditorialEventCard
                key={similar.id}
                {...mapEventToEditorialCardProps({
                  event: similar,
                  index: i + 1,
                  total: similarEvents.length,
                  locale: regional,
                  t: {
                    common: (k) => tCommon(k),
                    categories: (k) => tCategories(k as "conference"),
                    remainingSeats: (count) => tEventsCard("remainingSeats", { count }),
                    registeredWithFill: (count, pct) =>
                      tEventsCard("registeredWithFill", { count, pct }),
                    registeredCount: (count) => tEventsCard("registeredCount", { count }),
                  },
                })}
                linkComponent={Link}
                imageComponent={Image}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// —————————————————————————————————————————————
// Meta cell — vertical-divider column used in the 4-up meta row under
// the hero. First cell suppresses the left divider via md:first:pl-0.
// —————————————————————————————————————————————
function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="md:first:border-l-0 md:first:pl-0 md:pl-5 lg:pl-6">
      <p className="font-mono-kicker text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1.5 text-[15px] font-semibold text-foreground">{children}</div>
    </div>
  );
}

// Speaker avatar gradients — mirror the prototype's palette rotation
// when no photoURL is available. Keeps the wall of faces visually
// varied without shipping real imagery.
const SPEAKER_GRADIENTS = [
  "linear-gradient(135deg, #1A1A2E 0%, #16213E 100%)",
  "linear-gradient(135deg, #c59e4b 0%, #d1b372 100%)",
  "linear-gradient(135deg, #2a473c 0%, #0F9B58 100%)",
  "linear-gradient(135deg, #c86f4b 0%, #a78336 100%)",
];
