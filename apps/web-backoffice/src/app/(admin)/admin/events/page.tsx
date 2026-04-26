"use client";

import { useMemo } from "react";
import { parseAsBoolean, parseAsString } from "nuqs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  Select,
  DataTable,
  type DataTableColumn,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  SectionHeader,
  StatusPill,
  type StatusPillTone,
  ResultCount,
  PageSizeSelector,
} from "@teranga/shared-ui";
import { ChevronLeft, ChevronRight, Eye, Users, Building, Repeat } from "lucide-react";
import { useAdminEvents, useAdminOrganizations } from "@/hooks/use-admin";
import { useRowKeyboardNav } from "@/hooks/use-row-keyboard-nav";
import { useTableState } from "@/hooks/use-table-state";
import { useTranslations } from "next-intl";

const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "draft", label: "Brouillon" },
  { value: "published", label: "Publié" },
  { value: "cancelled", label: "Annulé" },
  { value: "completed", label: "Terminé" },
  { value: "archived", label: "Archivé" },
] as const;

const STATUS_STYLES: Record<string, { tone: StatusPillTone; label: string }> = {
  draft: { tone: "neutral", label: "Brouillon" },
  published: { tone: "success", label: "Publié" },
  cancelled: { tone: "danger", label: "Annulé" },
  completed: { tone: "info", label: "Terminé" },
  archived: { tone: "neutral", label: "Archivé" },
};

function formatDate(timestamp: string) {
  return new Date(timestamp).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminEventsPage() {
  const tCommon = useTranslations("common");
  void tCommon;
  const router = useRouter();

  // W3 migration — useTableState owns the URL state for status / seriesOnly
  // / sort / page / pageSize. The "Phase 7+ B1" recurring-series filter
  // is now a regular boolean in the filter map; preserves the same UX
  // (the toggle pill above the table reflects URL state).
  const t = useTableState<{ status?: string; seriesOnly?: boolean }>({
    urlNamespace: "events",
    defaults: { sort: { field: "createdAt", dir: "desc" }, pageSize: 25 },
    sortableFields: ["createdAt", "startDate", "title", "status"] as const,
    filterParsers: { status: parseAsString, seriesOnly: parseAsBoolean },
  });

  const { data, isLoading } = useAdminEvents({
    page: t.page,
    limit: t.pageSize,
    ...(t.filters.status ? { status: t.filters.status } : {}),
    ...(t.filters.seriesOnly ? { isRecurringParent: true } : {}),
    orderBy: t.sort?.field as "createdAt" | "startDate" | "title" | "status" | undefined,
    orderDir: t.sort?.dir,
  });

  const events = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: t.pageSize, total: 0, totalPages: 1 };
  const hasActive = t.activeFilterCount > 0 || !!t.q;

  // B2 — row keyboard nav.
  const { activeIndex, setActiveIndex } = useRowKeyboardNav({
    items: events,
    onSelect: (e) => router.push(`/admin/events/${encodeURIComponent(e.id as string)}`),
  });

  // Fetch organizations to display names instead of IDs
  const { data: orgsData } = useAdminOrganizations({ limit: 100 });
  const orgNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of orgsData?.data ?? []) {
      map.set(org.id, org.name);
    }
    return map;
  }, [orgsData]);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Événements</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <SectionHeader
        kicker="— ADMINISTRATION"
        title="Tous les événements"
        size="hero"
        as="h1"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ResultCount total={meta.total} loading={isLoading} />
            <PageSizeSelector value={t.pageSize} onChange={t.setPageSize} />
            <button
              type="button"
              onClick={() => t.setFilter("seriesOnly", t.filters.seriesOnly ? undefined : true)}
              aria-pressed={!!t.filters.seriesOnly}
              aria-label={
                t.filters.seriesOnly
                  ? "Désactiver le filtre séries"
                  : "Afficher uniquement les séries récurrentes"
              }
              className={
                t.filters.seriesOnly
                  ? "inline-flex items-center gap-1.5 rounded-md border border-teranga-gold bg-teranga-gold/10 px-3 py-1.5 text-sm font-medium text-teranga-gold transition-colors"
                  : "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
              }
            >
              <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
              Séries uniquement
            </button>
            <div className="w-full sm:w-56">
              <Select
                value={t.filters.status ?? ""}
                onChange={(e) => t.setFilter("status", e.target.value || undefined)}
                aria-label="Filtrer par statut"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            {hasActive ? (
              <button
                type="button"
                onClick={t.reset}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Tout effacer
              </button>
            ) : null}
          </div>
        }
      />

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <DataTable<Record<string, unknown>>
            aria-label="Liste des événements"
            emptyMessage={
              hasActive
                ? "Aucun résultat — essayez d'élargir les filtres."
                : "Aucun événement trouvé"
            }
            responsiveCards
            loading={isLoading}
            data={events as Record<string, unknown>[]}
            sort={t.sort}
            onToggleSort={t.toggleSort}
            // Whole-row click → admin event detail (organizer surface,
            // not the public /events/:id participant page — admins need
            // the organizer tools: edit, cancel, audit).
            onRowClick={(e) => router.push(`/admin/events/${encodeURIComponent(e.id as string)}`)}
            activeRowIndex={activeIndex}
            onRowHover={setActiveIndex}
            columns={
              [
                {
                  key: "title",
                  header: "Titre",
                  primary: true,
                  sortable: true,
                  sortField: "title",
                  render: (event) => {
                    const isParent = (event.isRecurringParent as boolean) === true;
                    const isChild = !!(event.parentEventId as string | null | undefined);
                    return (
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          href={`/admin/events/${encodeURIComponent(event.id as string)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="truncate font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {event.title as string}
                        </Link>
                        {isParent && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-full border border-teranga-gold/40 bg-teranga-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-teranga-gold"
                            aria-label="Anchor d'une série récurrente"
                            title="Anchor d'une série récurrente"
                          >
                            <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
                            Série
                          </span>
                        )}
                        {isChild && !isParent && (
                          <span
                            className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
                            aria-label="Occurrence d'une série récurrente"
                            title="Occurrence d'une série récurrente"
                          >
                            Occurrence
                          </span>
                        )}
                      </div>
                    );
                  },
                },
                {
                  key: "organization",
                  header: "Organisation",
                  hideOnMobile: true,
                  render: (event) => {
                    const orgId = event.organizationId as string;
                    const orgName = orgNameMap.get(orgId);
                    return orgName ? (
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Building className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate max-w-[200px]">{orgName}</span>
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">
                        {orgId?.slice(0, 12)}...
                      </span>
                    );
                  },
                },
                {
                  key: "status",
                  header: "Statut",
                  sortable: true,
                  sortField: "status",
                  render: (event) => {
                    const statusInfo =
                      STATUS_STYLES[(event.status as string) ?? "draft"] ?? STATUS_STYLES.draft;
                    return <StatusPill tone={statusInfo.tone} label={statusInfo.label} />;
                  },
                },
                {
                  key: "startDate",
                  header: "Date",
                  hideOnMobile: true,
                  sortable: true,
                  sortField: "startDate",
                  render: (event) => (
                    <span className="text-muted-foreground">
                      {event.startDate ? formatDate(event.startDate as string) : "-"}
                    </span>
                  ),
                },
                {
                  key: "registrationCount",
                  header: "Inscrits",
                  hideOnMobile: true,
                  render: (event) => (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      {(event.registrationCount as number) ?? 0}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  // Secondary affordance — opens the public participant
                  // view of the event for super-admins cross-checking
                  // what end-users see. Row-click takes operators to
                  // the admin shell; this button is the escape hatch.
                  stopRowNavigation: true,
                  render: (event) => (
                    <Link
                      href={`/events/${event.id as string}`}
                      target="_blank"
                      rel="noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      aria-label={`Voir la page publique de ${event.title as string}`}
                    >
                      <Eye className="h-4 w-4" />
                      <span className="hidden sm:inline">Page publique</span>
                    </Link>
                  ),
                },
              ] as DataTableColumn<Record<string, unknown>>[]
            }
          />
        </CardContent>
      </Card>

      {/* Pagination */}
      {!isLoading && meta.totalPages > 1 && (
        <nav
          aria-label="Pagination des événements"
          className="flex items-center justify-between text-sm text-muted-foreground"
        >
          <span aria-current="page">
            Page {meta.page} sur {meta.totalPages} ({meta.total} événement
            {meta.total > 1 ? "s" : ""})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => t.setPage(Math.max(1, t.page - 1))}
              disabled={t.page <= 1}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-4 w-4" />
              Précédent
            </button>
            <button
              type="button"
              onClick={() => t.setPage(Math.min(meta.totalPages, t.page + 1))}
              disabled={t.page >= meta.totalPages}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Page suivante"
            >
              Suivant
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
