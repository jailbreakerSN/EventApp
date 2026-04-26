import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Scale, Search } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { EditorialEventCard, EmptyStateEditorial, SectionHeader } from "@teranga/shared-ui";
import { serverEventsApi } from "@/lib/server-api";
import { mapEventToEditorialCardProps } from "@/lib/editorial-card-props";
import { EventFilters } from "@/components/event-filters";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { getDateRange } from "@/lib/date-utils";
import { intlLocale } from "@/lib/intl-locale";
import { Pagination } from "@/components/pagination";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("events");
  return {
    title: t("title"),
    description: t("metaDescription"),
  };
}

interface EventsPageProps {
  searchParams: Promise<{
    q?: string;
    /**
     * One or many categories. Comma-separated when multiple
     * ("conference,workshop") — the backend Zod preprocess splits and
     * validates. URL-shareable: a Slack link to a multi-category view
     * still lands the recipient on the same filtered grid.
     */
    category?: string;
    format?: string;
    city?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    price?: string;
    /** Sort field — whitelisted to startDate / createdAt / title at the API. */
    sortField?: string;
    /** Sort direction — asc or desc. */
    sortDir?: string;
    page?: string;
  }>;
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const [params, tEvents, tCommon, tCategories, tEventsCard, locale] = await Promise.all([
    searchParams,
    getTranslations("events"),
    getTranslations("common"),
    getTranslations("categories"),
    getTranslations("events.card"),
    getLocale(),
  ]);
  const regional = intlLocale(locale);
  const page = Number(params.page) || 1;

  // Resolve date range from shortcut or explicit params
  const dateRange = params.dateFrom
    ? { dateFrom: params.dateFrom, dateTo: params.dateTo }
    : getDateRange(params.date);

  let result;
  try {
    // category arrives as comma-separated when multi-select is active;
    // forwarded verbatim — the backend Zod preprocess splits it into an
    // array and validates against EventCategorySchema.
    const sortField =
      params.sortField === "startDate" ||
      params.sortField === "createdAt" ||
      params.sortField === "title"
        ? params.sortField
        : "startDate";
    const sortDir = params.sortDir === "desc" ? "desc" : "asc";
    result = await serverEventsApi.search({
      q: params.q,
      category: params.category as never,
      format: params.format as never,
      city: params.city,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      price: params.price === "free" || params.price === "paid" ? params.price : undefined,
      page,
      limit: 12,
      orderBy: sortField,
      orderDir: sortDir,
    });
  } catch {
    result = { data: [], meta: { page: 1, limit: 12, total: 0, totalPages: 0 } };
  }

  const events = result.data;
  const meta = result.meta;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* aria-live announces count updates to screen readers when filters change */}
      <SectionHeader
        kicker="— ÉVÉNEMENTS"
        title={tEvents("title")}
        size="hero"
        as="h1"
        subtitle={
          meta.total > 0
            ? tEvents("list.resultsCount", { count: meta.total })
            : tEvents("noResults")
        }
        action={
          <Link
            href="/events/compare"
            className="inline-flex items-center gap-2 rounded-full border border-teranga-navy/15 bg-card px-4 py-2 text-sm font-medium text-teranga-navy transition-colors hover:bg-teranga-navy hover:text-white dark:border-teranga-gold/30 dark:text-foreground dark:hover:bg-teranga-gold dark:hover:text-teranga-navy"
          >
            <Scale className="h-4 w-4" aria-hidden="true" />
            {tEvents("compareCta")}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      />
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {meta.total > 0
          ? tEvents("list.resultsCount", { count: meta.total })
          : tEvents("noResults")}
      </span>

      <EventFilters />

      {events.length > 0 ? (
        <>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {events.map((event) => (
              <EditorialEventCard
                key={event.id}
                {...mapEventToEditorialCardProps({
                  event,
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
          {meta.totalPages > 1 && (
            <div className="mt-8">
              <Pagination currentPage={page} totalPages={meta.totalPages} />
            </div>
          )}
        </>
      ) : (
        <EmptyStateEditorial
          icon={Search}
          kicker="— AUCUN RÉSULTAT"
          title={tEvents("noResults")}
          description={tEvents("noResultsHint")}
          action={
            <a
              href="/events"
              className="text-sm font-medium text-teranga-gold-dark hover:underline"
            >
              {tEvents("clearFilters")}
            </a>
          }
        />
      )}

      <div className="mt-16">
        <NewsletterSignup />
      </div>
    </div>
  );
}
