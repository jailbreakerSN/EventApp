"use client";

import { parseAsString } from "nuqs";
import { normalizeFr } from "@teranga/shared-types";
import Link from "next/link";
import type { EventCategory } from "@teranga/shared-types";
import { useEvents } from "@/hooks/use-events";
import { useTableState } from "@/hooks/use-table-state";
import { formatDate } from "@/lib/utils";
import { getEventStatusLabel } from "@/lib/event-status";
import { HealthBadgeMini } from "@/components/event-health/HealthBadgeMini";
import { Search, Plus, ChevronLeft, ChevronRight, Calendar, MapPin, Users } from "lucide-react";
import {
  Select,
  QueryError,
  Badge,
  getStatusVariant,
  EmptyState,
  DataTable,
  type DataTableColumn,
  ResultCount,
  PageSizeSelector,
} from "@teranga/shared-ui";

// Must match EventCategorySchema in packages/shared-types/src/event.types.ts
const CATEGORY_OPTIONS = [
  { value: "", label: "Toutes les catégories" },
  { value: "conference", label: "Conférence" },
  { value: "workshop", label: "Atelier" },
  { value: "concert", label: "Concert" },
  { value: "festival", label: "Festival" },
  { value: "networking", label: "Networking" },
  { value: "sport", label: "Sport" },
  { value: "exhibition", label: "Exposition" },
  { value: "ceremony", label: "Cérémonie" },
  { value: "training", label: "Formation" },
  { value: "other", label: "Autre" },
];

const SORTABLE_FIELDS = ["startDate", "createdAt", "title"] as const;

export default function EventsPage() {
  const t = useTableState<{ category?: string }>({
    urlNamespace: "events",
    defaults: { sort: { field: "startDate", dir: "desc" }, pageSize: 25 },
    sortableFields: SORTABLE_FIELDS,
    filterParsers: { category: parseAsString },
  });

  const { data, isLoading, isError, refetch } = useEvents({
    page: t.page,
    limit: t.pageSize,
    category: (t.filters.category || undefined) as EventCategory | undefined,
    orderBy: t.sort?.field,
    orderDir: t.sort?.dir,
  });

  const allEvents = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  // Title search stays client-side per the doctrine for organiser-scoped
  // event listings: bounded cardinality, per-page substring is acceptable,
  // and the participant /events page already covers cross-org full-text
  // via searchKeywords[]. normalizeFr matches behaviour ("senegal" vs
  // "Sénégal") with the rest of the platform. P2 graduates this to a
  // server-side searchKeywords query alongside the orgEvents endpoint.
  const normalizedNeedle = t.debouncedQ ? normalizeFr(t.debouncedQ) : "";
  const events = normalizedNeedle
    ? allEvents.filter((event) => normalizeFr(event.title).includes(normalizedNeedle))
    : allEvents;

  const hasActiveFilter = t.activeFilterCount > 0 || !!t.q;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Événements</h1>
        <Link
          href="/events/new"
          className="inline-flex items-center gap-2 bg-primary text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Créer un événement
        </Link>
      </div>

      {/* Filters — wired through useTableState (URL-persistent). */}
      <div className="space-y-3 mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              role="searchbox"
              placeholder="Rechercher un événement..."
              value={t.q}
              onChange={(e) => t.setQ(e.target.value)}
              aria-label="Rechercher un événement"
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ResultCount total={meta?.total} loading={isLoading} />
            <PageSizeSelector value={t.pageSize} onChange={t.setPageSize} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={t.filters.category ?? ""}
            onChange={(e) => t.setFilter("category", e.target.value || undefined)}
            aria-label="Filtrer par catégorie"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={t.reset}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              Tout effacer
            </button>
          ) : null}
        </div>
      </div>

      {/* Content */}
      {isError ? (
        <QueryError onRetry={refetch} />
      ) : !isLoading && events.length === 0 ? (
        <div className="bg-card rounded-xl border border-border">
          {hasActiveFilter ? (
            <EmptyState
              icon={Search}
              title="Aucun résultat"
              description="Aucun événement ne correspond à vos filtres. Essayez d'élargir votre recherche."
              action={
                <button
                  type="button"
                  onClick={t.reset}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Effacer les filtres
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={Calendar}
              title="Aucun événement pour le moment"
              description="Créez votre premier événement pour commencer à accueillir des participants."
              action={
                <Link
                  href="/events/new"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Créer un événement
                </Link>
              }
            />
          )}
        </div>
      ) : (
        <>
          <DataTable<(typeof events)[number] & Record<string, unknown>>
            aria-label="Liste des événements"
            responsiveCards
            loading={isLoading}
            data={events as ((typeof events)[number] & Record<string, unknown>)[]}
            sort={t.sort}
            onToggleSort={t.toggleSort}
            columns={
              [
                {
                  key: "title",
                  header: "Événement",
                  primary: true,
                  sortable: true,
                  sortField: "title",
                  render: (event) => (
                    <span className="font-medium text-foreground max-w-[250px] truncate inline-block">
                      {event.title}
                    </span>
                  ),
                },
                {
                  key: "startDate",
                  header: "Date",
                  sortable: true,
                  sortField: "startDate",
                  render: (event) => (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground whitespace-nowrap">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(event.startDate)}
                    </span>
                  ),
                },
                {
                  key: "city",
                  header: "Lieu",
                  hideOnMobile: true,
                  render: (event) =>
                    event.location?.city ? (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground whitespace-nowrap">
                        <MapPin className="h-3.5 w-3.5" />
                        {event.location.city}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    ),
                },
                {
                  key: "category",
                  header: "Catégorie",
                  hideOnMobile: true,
                  render: (event) => (
                    <span className="text-muted-foreground capitalize">
                      {event.category ?? "—"}
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Statut",
                  render: (event) => (
                    <Badge variant={getStatusVariant(event.status)}>
                      {getEventStatusLabel(event.status)}
                    </Badge>
                  ),
                },
                {
                  key: "registered",
                  header: "Inscrits",
                  render: (event) => (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      {event.registeredCount ?? 0}
                    </span>
                  ),
                },
                {
                  key: "health",
                  header: "Santé",
                  hideOnMobile: true,
                  render: (event) => (
                    <HealthBadgeMini
                      registeredCount={event.registeredCount ?? 0}
                      maxAttendees={event.maxAttendees ?? null}
                      startDate={event.startDate}
                    />
                  ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  stopRowNavigation: true,
                  render: (event) => (
                    <Link
                      href={`/events/${event.id}`}
                      className="text-primary hover:underline font-medium text-sm"
                    >
                      Voir
                    </Link>
                  ),
                },
              ] as DataTableColumn<(typeof events)[number] & Record<string, unknown>>[]
            }
          />

          {/* Pagination */}
          {totalPages > 1 ? (
            <nav
              className="flex items-center justify-between mt-4 text-sm text-muted-foreground"
              aria-label="Pagination des événements"
            >
              <span aria-current="page">
                Page {t.page} sur {totalPages} ({meta?.total ?? 0} résultat
                {(meta?.total ?? 0) > 1 ? "s" : ""})
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => t.setPage(Math.max(1, t.page - 1))}
                  disabled={t.page <= 1}
                  aria-label="Page précédente"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Précédent
                </button>
                <button
                  type="button"
                  onClick={() => t.setPage(Math.min(totalPages, t.page + 1))}
                  disabled={t.page >= totalPages}
                  aria-label="Page suivante"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Suivant <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
