import Link from "next/link";
import Image from "next/image";
import { Search, ArrowRight, ArrowUpRight } from "lucide-react";
import { getTranslations, getLocale } from "next-intl/server";
import { serverEventsApi } from "@/lib/server-api";
import { getCoverGradient } from "@/lib/cover-gradient";
import { mapEventToEditorialCardProps } from "@/lib/editorial-card-props";
import { intlLocale } from "@/lib/intl-locale";
import { EditorialEventCard, formatCurrency, formatDate, SectionHeader } from "@teranga/shared-ui";
import type { Event } from "@teranga/shared-types";

export default async function HomePage() {
  const [tHome, tCommon, tCategories, tEventsCard, locale] = await Promise.all([
    getTranslations("home"),
    getTranslations("common"),
    getTranslations("categories"),
    getTranslations("events.card"),
    getLocale(),
  ]);

  let featuredEvents: Event[] = [];
  try {
    const result = await serverEventsApi.search({ isFeatured: true, limit: 3 });
    featuredEvents = result.data;
  } catch {
    // fallback to empty
  }

  let latestEvents: Event[] = [];
  try {
    const result = await serverEventsApi.search({
      limit: 8,
      orderBy: "startDate",
      orderDir: "asc",
    });
    latestEvents = result.data;
  } catch {
    // fallback to empty
  }

  const categoryChips: {
    slug: "conference" | "workshop" | "networking" | "concert" | "festival" | "training" | "sport";
    glyph: string;
    labelKey: string;
  }[] = [
    { slug: "conference", glyph: "◇", labelKey: "conference_plural" },
    { slug: "workshop", glyph: "◆", labelKey: "workshop_plural" },
    { slug: "concert", glyph: "♪", labelKey: "concert_plural" },
    { slug: "networking", glyph: "⬡", labelKey: "networking" },
    { slug: "festival", glyph: "✦", labelKey: "festival_plural" },
    { slug: "training", glyph: "◈", labelKey: "training_plural" },
  ];

  const regional = intlLocale(locale);

  return (
    <>
      {/* ——— Hero ——— */}
      <section className="relative overflow-hidden bg-gradient-to-br from-teranga-navy via-teranga-navy-2 to-teranga-forest text-white">
        <div aria-hidden className="absolute inset-0 teranga-hero-texture" />

        <div className="container relative mx-auto max-w-7xl px-6 pt-16 pb-20 lg:px-8 lg:pt-20 lg:pb-24">
          <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr] lg:items-center lg:gap-14">
            {/* Left column — hero copy */}
            <div>
              <p className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.18em] text-teranga-gold-light">
                {tHome("hero.kicker")}
              </p>
              <h1 className="font-serif-display mt-5 text-5xl font-medium leading-[0.98] tracking-[-0.03em] sm:text-6xl lg:text-[76px]">
                {/* Keyword-rich heading for search engines and screen readers.
                    Kept visually hidden so the editorial display headline
                    below reads as the primary composition. */}
                <span className="sr-only">{tHome("hero.srTitle")}</span>
                <span aria-hidden="true">
                  {tHome("hero.titleLead")}
                  <br />
                  <em className="italic font-medium text-teranga-gold-light">
                    {tHome("hero.titleItalicOne")}
                  </em>{" "}
                  {tHome("hero.titleGlue")}{" "}
                  <em className="italic font-medium text-teranga-gold-light">
                    {tHome("hero.titleItalicTwo")}
                  </em>
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
                {tHome("hero.subtitle")}
              </p>

              {/* Primary CTA (the prototype's "Explorer" search-pill submit
                  is the secondary action; this restores the one-click browse
                  path for visitors without a query in mind). */}
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href="/events"
                  className="inline-flex items-center gap-2 rounded-full bg-teranga-gold px-7 py-3.5 text-sm font-semibold text-teranga-navy shadow-lg shadow-teranga-gold/20 transition-colors hover:bg-teranga-gold-light"
                >
                  {tHome("hero.cta")}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="#comment-ca-marche"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
                >
                  {tHome("hero.secondaryCta")}
                </Link>
              </div>

              {/* Search pill */}
              <form
                action="/events"
                method="GET"
                className="mt-8 flex max-w-xl items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] p-1.5 backdrop-blur-sm"
              >
                <label htmlFor="hero-search" className="sr-only">
                  {tHome("hero.searchPlaceholder")}
                </label>
                <div className="flex flex-1 items-center gap-2.5 pl-4">
                  <Search className="h-4 w-4 text-white/60" aria-hidden="true" />
                  <input
                    id="hero-search"
                    name="q"
                    type="search"
                    placeholder={tHome("hero.searchPlaceholder")}
                    className="flex-1 bg-transparent py-3 text-sm text-white placeholder:text-white/50 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex h-[46px] shrink-0 items-center justify-center gap-2 rounded-full bg-teranga-gold px-6 text-sm font-semibold text-teranga-navy transition-colors hover:bg-teranga-gold-light"
                >
                  {tHome("hero.searchCta")}
                </button>
              </form>

              {/* Stat row */}
              <dl className="mt-11 grid grid-cols-2 gap-y-6 border-t border-white/10 pt-7 sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-0">
                {[
                  { n: "412", l: tHome("heroStats.events") },
                  { n: "38k", l: tHome("heroStats.registrations") },
                  { n: "24", l: tHome("heroStats.cities") },
                  { n: "4.8★", l: tHome("heroStats.rating") },
                ].map((s) => (
                  <div key={s.l}>
                    <dt className="sr-only">{s.l}</dt>
                    <dd className="font-serif-display text-[26px] font-semibold leading-none text-white">
                      {s.n}
                    </dd>
                    <p className="font-mono-kicker mt-1 text-[10px] uppercase tracking-[0.1em] text-white/55">
                      {s.l}
                    </p>
                  </div>
                ))}
              </dl>
            </div>

            {/* Right column — decorative ticket stub.
                Purely illustrative; the real pass is rendered in the
                registration success flow. Hide from AT to avoid
                reading out made-up names and codes. */}
            <div className="hidden lg:block" aria-hidden="true">
              <TicketStub
                kicker={tHome("ticketStub.kicker")}
                title={tHome("ticketStub.defaultTitle")}
                labelDate={tHome("ticketStub.labelDate")}
                labelPass={tHome("ticketStub.labelPass")}
                labelZone={tHome("ticketStub.labelZone")}
                valueDate={tHome("ticketStub.defaultDate")}
                valuePass={tHome("ticketStub.defaultPass")}
                valueZone={tHome("ticketStub.defaultZone")}
                holderLabel={tHome("ticketStub.holderLabel")}
                holderName={tHome("ticketStub.defaultHolder")}
                code={tHome("ticketStub.defaultCode")}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ——— Featured editorial ——— */}
      {featuredEvents.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 pt-20 pb-4 lg:px-8 lg:pt-24">
          <SectionHeader
            kicker={tHome("featured.kicker")}
            title={tHome("featured.title")}
            subtitle={tHome("featured.subtitle")}
          />
          <div className="mt-10 flex flex-col gap-6">
            {featuredEvents.map((event, i) => (
              <FeaturedTile
                key={event.id}
                event={event}
                index={i + 1}
                total={featuredEvents.length}
                locale={regional}
                categoryLabel={tCategories(`${event.category}` as "conference")}
                detailsCta={tHome("featured.cta")}
                registerCta={tCommon("viewDetails")}
                dateLabel={tCommon("date")}
                locationLabel={tCommon("location")}
                priceLabel={tCommon("price")}
                freeLabel={tCommon("free")}
                attendeesLabel={tHome("heroStats.registrations")}
              />
            ))}
          </div>
        </section>
      )}

      {/* ——— Browse all events ——— */}
      <section className="mx-auto max-w-7xl px-6 pt-20 pb-4 lg:px-8 lg:pt-24">
        <SectionHeader
          kicker={tHome("browse.kicker")}
          title={tHome("browse.title")}
          subtitle={tHome("browse.subtitle")}
          action={
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {tHome("browse.countLabel", { count: latestEvents.length })}
            </span>
          }
        />

        {/* Category chips */}
        <div
          role="list"
          className="mt-8 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {categoryChips.map(({ slug, glyph, labelKey }) => (
            <Link
              role="listitem"
              key={slug}
              href={`/events?category=${slug}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-teranga-navy hover:bg-teranga-navy hover:text-white"
            >
              <span aria-hidden className="text-base opacity-60">
                {glyph}
              </span>
              {tCategories(labelKey as "conference_plural")}
            </Link>
          ))}
        </div>

        {/* Event grid */}
        {latestEvents.length > 0 ? (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {latestEvents.map((event, i) => (
              <EditorialEventCard
                key={event.id}
                {...mapEventToEditorialCardProps({
                  event,
                  index: i + 1,
                  total: latestEvents.length,
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
        ) : (
          <div className="mt-8 rounded-2xl border border-dashed px-6 py-16 text-center">
            <p className="font-serif-display text-2xl font-semibold">{tCommon("loading")}</p>
          </div>
        )}

        <div className="mt-10 text-center">
          <Link
            href="/events"
            className="inline-flex items-center gap-2 rounded-full border border-teranga-navy/15 bg-card px-6 py-3 text-sm font-semibold text-teranga-navy transition-colors hover:bg-teranga-navy hover:text-white dark:text-foreground dark:hover:bg-teranga-gold dark:hover:text-teranga-navy"
          >
            {tCommon("viewAll")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* ——— Value prop band ——— */}
      <section className="mx-auto mt-24 max-w-7xl px-6 lg:px-8">
        <div className="grid border-y md:grid-cols-3">
          {[tHome.raw("promises.one"), tHome.raw("promises.two"), tHome.raw("promises.three")].map(
            (p: { num: string; title: string; description: string }, i) => (
              <div
                key={p.num}
                className={`px-6 py-10 lg:px-8 lg:py-12 ${
                  i > 0 ? "border-t md:border-t-0 md:border-l" : ""
                }`}
              >
                <p className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.14em] text-teranga-gold-dark">
                  {p.num}
                </p>
                <h3 className="font-serif-display mt-3 text-[22px] font-semibold leading-snug tracking-[-0.015em]">
                  {p.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                  {p.description}
                </p>
              </div>
            ),
          )}
        </div>
      </section>

      {/* ——— How it works — editorial onboarding signpost ——— */}
      <section id="comment-ca-marche" className="mx-auto mt-24 max-w-7xl px-6 lg:px-8">
        <SectionHeader
          kicker={tHome("howItWorks.kicker")}
          title={tHome("howItWorks.heading")}
          subtitle={tHome("howItWorks.subheading")}
        />
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {(["step1", "step2", "step3"] as const).map((key, i) => (
            <li
              key={key}
              className="group relative flex flex-col justify-between gap-6 rounded-card border bg-card p-7 transition-shadow hover:shadow-lg"
            >
              <div>
                <span className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.14em] text-teranga-gold-dark">
                  {tHome("howItWorks.stepLabel", { n: i + 1 })}
                </span>
                <h3 className="font-serif-display mt-3 text-2xl font-semibold leading-snug tracking-[-0.015em]">
                  {tHome(`howItWorks.${key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {tHome(`howItWorks.${key}.description`)}
                </p>
              </div>
              <span
                aria-hidden="true"
                className="font-serif-display text-5xl font-semibold text-teranga-gold/30 transition-colors group-hover:text-teranga-gold/50"
              >
                0{i + 1}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* ——— Organizer CTA ——— */}
      <section className="mt-24 bg-gradient-to-br from-teranga-navy to-teranga-navy/90 px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-serif-display text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">
            {tHome("organizerCta.heading")}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/70">
            {tHome("organizerCta.body")}
          </p>
          <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full bg-teranga-gold px-8 py-3.5 text-base font-semibold text-teranga-navy shadow-lg transition-colors hover:bg-teranga-gold-light"
            >
              {tHome("organizerCta.primary")}
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
            <a
              href={process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "http://localhost:3001"}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-base font-medium text-white transition-colors hover:bg-white/10"
              target="_blank"
              rel="noopener noreferrer"
            >
              {tHome("organizerCta.secondary")}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

// —————————————————————————————————————————————
// Featured tile — split cover / content card (1.1fr / 1fr on desktop).
// The cover uses a branded gold→navy gradient fallback when the event
// has no coverImageURL, so the layout looks editorial even on fresh data.
// —————————————————————————————————————————————
function FeaturedTile({
  event,
  index,
  total,
  locale,
  categoryLabel,
  detailsCta,
  registerCta,
  dateLabel,
  locationLabel,
  priceLabel,
  freeLabel,
  attendeesLabel,
}: {
  event: Event;
  index: number;
  total: number;
  locale: string;
  categoryLabel: string;
  detailsCta: string;
  registerCta: string;
  dateLabel: string;
  locationLabel: string;
  priceLabel: string;
  freeLabel: string;
  attendeesLabel: string;
}) {
  const minPrice =
    event.ticketTypes.length > 0 ? Math.min(...event.ticketTypes.map((t) => t.price)) : null;
  const priceText =
    minPrice === null || minPrice === 0 ? freeLabel : formatCurrency(minPrice, "XOF", locale);

  const city = event.location?.city ?? event.location?.name ?? "";

  return (
    <article className="grid overflow-hidden rounded-[20px] border bg-card md:grid-cols-[1.1fr_1fr]">
      {/* Cover */}
      <Link
        href={`/events/${event.slug}`}
        aria-label={event.title}
        className="teranga-cover relative block min-h-[280px] md:min-h-[380px]"
        style={{
          background: event.coverImageURL ? undefined : getCoverGradient(event.id).bg,
        }}
      >
        {event.coverImageURL && (
          <Image
            src={event.coverImageURL}
            alt=""
            fill
            className="z-0 object-cover"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
        )}
        <div className="relative z-10 flex h-full flex-col justify-between p-7 text-white">
          <div className="flex items-center justify-between">
            <span className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.08em] text-white/90">
              {categoryLabel}
            </span>
            <span className="font-mono-kicker text-[10px] tracking-[0.1em] text-white/70">
              TER · {String(index).padStart(3, "0")}/{String(total).padStart(3, "0")}
            </span>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/45"
          />
          <h3 className="font-serif-display relative max-w-[460px] text-[28px] font-semibold leading-[1.05] tracking-[-0.02em] text-white sm:text-[32px] lg:text-[40px]">
            {event.title}
          </h3>
        </div>
      </Link>

      {/* Content */}
      <div className="flex flex-col justify-between gap-6 p-7 lg:p-9">
        <div>
          {event.tags && event.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {event.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center rounded-full border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <p className="mt-5 text-base leading-relaxed text-foreground/80">
            {event.description?.slice(0, 200) ?? event.title}
            {event.description && event.description.length > 200 ? "…" : ""}
          </p>

          {/* Meta grid */}
          <dl className="mt-6 grid grid-cols-2 gap-y-4 border-y py-5">
            <FeaturedMeta label={dateLabel} value={formatDate(event.startDate, locale)} />
            <FeaturedMeta label={locationLabel} value={city || "—"} />
            <FeaturedMeta label={priceLabel} value={priceText} />
            <FeaturedMeta
              label={attendeesLabel}
              value={new Intl.NumberFormat("fr-FR").format(event.registeredCount ?? 0)}
              icon={
                <span
                  aria-hidden
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-teranga-green teranga-pulse-dot align-middle"
                />
              }
            />
          </dl>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/events/${event.slug}`}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-teranga-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
          >
            {registerCta}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href={`/events/${event.slug}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            {detailsCta}
          </Link>
        </div>
      </div>
    </article>
  );
}

function FeaturedMeta({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-mono-kicker text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-[15px] font-semibold text-foreground">
        {value}
        {icon}
      </dd>
    </div>
  );
}

// —————————————————————————————————————————————
// Decorative "tactile pass" illustration that anchors the hero.
// Labels come from i18n so French / English / Wolof all feel native.
// —————————————————————————————————————————————
function TicketStub({
  kicker,
  title,
  labelDate,
  labelPass,
  labelZone,
  valueDate,
  valuePass,
  valueZone,
  holderLabel,
  holderName,
  code,
}: {
  kicker: string;
  title: string;
  labelDate: string;
  labelPass: string;
  labelZone: string;
  valueDate: string;
  valuePass: string;
  valueZone: string;
  holderLabel: string;
  holderName: string;
  code: string;
}) {
  return (
    <div className="relative mx-auto w-full max-w-[360px] -rotate-[4deg]">
      <div className="relative rounded-[18px] bg-[#faf6ee] px-7 pt-7 pb-6 text-teranga-navy shadow-[0_40px_80px_-30px_rgba(0,0,0,0.5)]">
        <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.18em] text-teranga-gold-dark">
          {kicker}
        </p>
        <p className="font-serif-display mt-4 text-[28px] font-semibold leading-[1.05] tracking-[-0.015em]">
          {title}
        </p>
        <div className="mt-5 flex justify-between gap-3">
          <TicketStubField label={labelDate} value={valueDate} />
          <TicketStubField label={labelPass} value={valuePass} />
          <TicketStubField label={labelZone} value={valueZone} />
        </div>

        {/* Perforation */}
        <div className="relative my-5 -mx-7 border-t-2 border-dashed border-teranga-navy/15">
          <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full bg-teranga-navy" />
          <span className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full bg-teranga-navy" />
        </div>

        <div className="flex items-center gap-3.5">
          <div className="rounded-[10px] border bg-white p-1.5">
            <DecorativeQR size={82} seed={code} />
          </div>
          <div className="flex-1">
            <p className="font-mono-kicker text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {holderLabel}
            </p>
            <p className="mt-0.5 text-sm font-semibold">{holderName}</p>
            <p className="font-mono-kicker mt-1.5 text-[10px] tracking-[0.08em] text-muted-foreground">
              {code}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketStubField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono-kicker text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-[13px] font-semibold">{value}</p>
    </div>
  );
}

// Decorative SVG that reads as a QR code from a glance. Not a real QR —
// the real one is signed server-side and rendered inside the registration flow.
function DecorativeQR({ size = 82, seed = "TER" }: { size?: number; seed?: string }) {
  const cells = 29;
  const cell = size / cells;

  const hash = (i: number) => {
    let x = 0;
    for (let k = 0; k < seed.length; k++) {
      x = (x * 131 + seed.charCodeAt(k) + i * 17) >>> 0;
    }
    return x;
  };

  const grid: boolean[][] = [];
  for (let y = 0; y < cells; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < cells; x++) {
      row.push((hash(y * cells + x) & 1) === 1);
    }
    grid.push(row);
  }
  const drawFinder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const onEdge = x === 0 || y === 0 || x === 6 || y === 6;
        const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        grid[oy + y][ox + x] = onEdge || inner;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(cells - 7, 0);
  drawFinder(0, cells - 7);
  for (let i = 0; i < 8; i++) {
    if (i < cells) {
      grid[7][i] = false;
      grid[i][7] = false;
      grid[cells - 8][i] = false;
      grid[i][cells - 8] = false;
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Teranga pass QR code"
      className="block"
    >
      <rect width={size} height={size} fill="#fff" />
      {grid.flatMap((row, y) =>
        row.map(
          (on, x) =>
            on && (
              <rect
                key={`${x}-${y}`}
                x={x * cell}
                y={y * cell}
                width={cell + 0.4}
                height={cell + 0.4}
                fill="#0d0d18"
                rx={cell * 0.18}
              />
            ),
        ),
      )}
    </svg>
  );
}
