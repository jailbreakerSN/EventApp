import type { Metadata } from "next";
import { serverEventsApi } from "@/lib/server-api";
import { EventCard } from "@/components/event-card";
import { EventFilters } from "@/components/event-filters";
import { getDateRange } from "@/lib/date-utils";
import { Pagination } from "@/components/pagination";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Événements",
  description: "Découvrez les événements au Sénégal — conférences, concerts, ateliers, festivals et plus.",
};

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
  const params = await searchParams;
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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Événements</h1>
        <p className="mt-2 text-muted-foreground">
          {meta.total > 0
            ? `${meta.total} événement${meta.total > 1 ? "s" : ""} trouvé${meta.total > 1 ? "s" : ""}`
            : "Aucun événement trouvé"}
        </p>
      </div>

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
        <div className="mt-12 text-center">
          <p className="text-lg text-muted-foreground">
            Aucun événement ne correspond à vos critères.
          </p>
          <a href="/events" className="mt-4 inline-block text-sm font-medium text-teranga-gold hover:underline">
            Réinitialiser les filtres
          </a>
        </div>
      )}
    </div>
  );
}
