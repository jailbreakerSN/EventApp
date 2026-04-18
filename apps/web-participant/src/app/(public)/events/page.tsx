import type { Metadata } from "next";
import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyStateEditorial, SectionHeader } from "@teranga/shared-ui";
import { serverEventsApi } from "@/lib/server-api";
import { EventCard } from "@/components/event-card";
import { EventFilters } from "@/components/event-filters";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { getDateRange } from "@/lib/date-utils";
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
    category?: string;
    format?: string;
    city?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    price?: string;
    page?: string;
  }>;
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const [params, tEvents] = await Promise.all([searchParams, getTranslations("events")]);
  const page = Number(params.page) || 1;

  // Resolve date range from shortcut or explicit params
  const dateRange = params.dateFrom
    ? { dateFrom: params.dateFrom, dateTo: params.dateTo }
    : getDateRange(params.date);

  let result;
  try {
    result = await serverEventsApi.search({
      q: params.q,
      category: params.category as never,
      format: params.format as never,
      city: params.city,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      page,
      limit: 12,
      orderBy: "startDate",
      orderDir: "asc",
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
      />
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {meta.total > 0
          ? tEvents("list.resultsCount", { count: meta.total })
          : tEvents("noResults")}
      </span>

      <EventFilters />

      {events.length > 0 ? (
        <>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
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
