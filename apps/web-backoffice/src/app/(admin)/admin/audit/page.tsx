"use client";

import { useMemo } from "react";
import Link from "next/link";
import { parseAsString, parseAsStringEnum, useQueryStates } from "nuqs";
import { CsvExportButton } from "@/components/admin/csv-export-button";
import { SavedViewsBar } from "@/components/admin/saved-views-bar";
import { AuditDiffView } from "@/components/admin/audit-diff-view";
import {
  Card,
  CardContent,
  Badge,
  Select,
  Input,
  DataTable,
  type DataTableColumn,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  ResultCount,
  PageSizeSelector,
} from "@teranga/shared-ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAdminAuditLogs } from "@/hooks/use-admin";
import { useTableState } from "@/hooks/use-table-state";
import { useTranslations } from "next-intl";
import { groupAuditRowsByDakarDay, type TimelineLog } from "@/lib/audit-timeline";

const ACTION_OPTIONS = [
  { value: "", label: "Toutes les actions" },
  { value: "registration", label: "Inscriptions" },
  { value: "event", label: "Événements" },
  { value: "organization", label: "Organisations" },
  { value: "venue", label: "Lieux" },
  { value: "user", label: "Utilisateurs" },
  { value: "payment", label: "Paiements" },
] as const;

type ActionFilter = (typeof ACTION_OPTIONS)[number]["value"];

const ACTION_GROUP_STYLES: Record<
  string,
  { variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline" }
> = {
  registration: { variant: "default" },
  event: { variant: "success" },
  organization: { variant: "secondary" },
  venue: { variant: "outline" },
  user: { variant: "destructive" },
  payment: { variant: "warning" },
};

function getActionStyle(action: string) {
  const group = action.split(".")[0];
  return ACTION_GROUP_STYLES[group] ?? { variant: "outline" as const };
}

// Map resourceType → admin detail URL builder. Extend when a new admin
// detail page lands. Returning null keeps the cell non-clickable (the
// current fallback, used for actor / plan / audit-self resources that
// have no dedicated drill-down page).
const RESOURCE_DETAIL_URL: Record<string, (id: string) => string | null> = {
  event: (id) => `/admin/events/${encodeURIComponent(id)}`,
  organization: (id) => `/admin/organizations/${encodeURIComponent(id)}`,
  user: (id) => `/admin/users/${encodeURIComponent(id)}`,
  venue: (id) => `/admin/venues/${encodeURIComponent(id)}`,
  plan: (id) => `/admin/plans/${encodeURIComponent(id)}`,
};

function getResourceUrl(type: string, id: string): string | null {
  const builder = RESOURCE_DETAIL_URL[type];
  if (!builder || !id) return null;
  return builder(id);
}

function formatDate(timestamp: string) {
  // Senegal locale — consistent with the rest of the audit page +
  // all other admin surfaces. Audit findings showed this one helper
  // was the single drift from fr-SN; l10n-auditor T2.6 fix.
  return new Date(timestamp).toLocaleString("fr-SN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type Filters = {
  action?: ActionFilter;
  actorId?: string;
  resourceType?: string;
  dateFrom?: string;
  dateTo?: string;
};

export default function AdminAuditPage() {
  const tCommon = useTranslations("common");
  void tCommon;

  // W2 migration — useTableState owns the URL state for q / filters /
  // page / pageSize. Phase 7 deep-link contract preserved: external links
  // landing on /admin/audit?actorId=xyz / ?resourceType=organization /
  // ?action=payment.failed still reach the filtered view because nuqs
  // hydrates from URL on mount.
  const t = useTableState<Filters>({
    urlNamespace: "",
    defaults: { sort: null, pageSize: 25 },
    sortableFields: [],
    filterParsers: {
      action: parseAsStringEnum<ActionFilter>(["", "registration", "event", "organization", "venue", "user", "payment"]),
      actorId: parseAsString,
      resourceType: parseAsString,
      dateFrom: parseAsString,
      dateTo: parseAsString,
    },
    debounceMs: 300,
  });

  // viewMode is a UI discriminator (table vs timeline), not a result
  // filter — keep it out of useTableState so it doesn't inflate
  // activeFilterCount. Persisted to URL in its own slot for
  // bookmarkability.
  const [{ view }, setViewUrl] = useQueryStates(
    { view: parseAsStringEnum<"table" | "timeline">(["table", "timeline"]) },
    { history: "replace", shallow: true },
  );
  const viewMode: "table" | "timeline" = view ?? "table";
  const setViewMode = (next: "table" | "timeline") =>
    setViewUrl({ view: next === "table" ? null : next });

  const { data, isLoading } = useAdminAuditLogs({
    page: t.page,
    limit: t.pageSize,
    ...(t.filters.action ? { action: t.filters.action } : {}),
    ...(t.filters.actorId ? { actorId: t.filters.actorId } : {}),
    ...(t.filters.resourceType ? { resourceType: t.filters.resourceType } : {}),
    ...(t.debouncedQ.trim().length >= 2 ? { search: t.debouncedQ.trim() } : {}),
    ...(t.filters.dateFrom ? { dateFrom: t.filters.dateFrom } : {}),
    ...(t.filters.dateTo ? { dateTo: t.filters.dateTo } : {}),
  });

  const logs = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: t.pageSize, total: 0, totalPages: 1 };
  const filteredLogs = logs;

  const timelineGroups = useMemo(() => {
    if (viewMode !== "timeline") return null;
    return groupAuditRowsByDakarDay(filteredLogs as TimelineLog[]);
  }, [filteredLogs, viewMode]);

  // Build the querystring passed to the CSV export so the exported file
  // mirrors whatever the admin is currently looking at.
  const exportFilters = useMemo(() => {
    const params = new URLSearchParams();
    if (t.filters.action) params.set("action", t.filters.action);
    if (t.filters.actorId) params.set("actorId", t.filters.actorId);
    if (t.filters.resourceType) params.set("resourceType", t.filters.resourceType);
    if (t.filters.dateFrom) params.set("dateFrom", t.filters.dateFrom);
    if (t.filters.dateTo) params.set("dateTo", t.filters.dateTo);
    return params.toString();
  }, [t.filters]);

  const hasActive = t.q || t.activeFilterCount > 0;

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
            <BreadcrumbPage>Journal d&apos;audit</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header + export action + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">Journal d&apos;audit</h1>
        <div className="flex items-center gap-2">
          <ResultCount total={meta.total} loading={isLoading} />
          <PageSizeSelector value={t.pageSize} onChange={t.setPageSize} />
          <div
            role="tablist"
            aria-label="Type d'affichage"
            className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs"
          >
            <button
              role="tab"
              aria-selected={viewMode === "table"}
              onClick={() => setViewMode("table")}
              className={`px-3 py-1 rounded ${
                viewMode === "table" ? "bg-teranga-navy text-white" : "text-muted-foreground"
              }`}
            >
              Tableau
            </button>
            <button
              role="tab"
              aria-selected={viewMode === "timeline"}
              onClick={() => setViewMode("timeline")}
              className={`px-3 py-1 rounded ${
                viewMode === "timeline" ? "bg-teranga-navy text-white" : "text-muted-foreground"
              }`}
            >
              Chronologie
            </button>
          </div>
          <CsvExportButton resource="audit-logs" filters={exportFilters} />
        </div>
      </div>

      {/* Saved views chip bar. */}
      <SavedViewsBar surfaceKey="admin-audit" />

      {/* Active-filter breadcrumb pills (Phase 7 — visible state). */}
      {(t.filters.actorId || t.filters.resourceType || hasActive) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Filtres :</span>
          {t.filters.actorId && (
            <Badge variant="outline" className="gap-1.5 py-1">
              actor = <code className="font-mono text-[10px]">{t.filters.actorId.slice(0, 12)}…</code>
              <button
                type="button"
                onClick={() => t.setFilter("actorId", undefined)}
                aria-label="Retirer le filtre actor"
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </Badge>
          )}
          {t.filters.resourceType && (
            <Badge variant="outline" className="gap-1.5 py-1">
              type = {t.filters.resourceType}
              <button
                type="button"
                onClick={() => t.setFilter("resourceType", undefined)}
                aria-label="Retirer le filtre type"
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </Badge>
          )}
          {hasActive && (
            <button
              type="button"
              onClick={t.reset}
              className="ml-auto text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              Tout effacer
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="w-full sm:flex-1 sm:min-w-[200px]">
          <label
            htmlFor="audit-text-filter"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Recherche
          </label>
          <Input
            id="audit-text-filter"
            type="search"
            placeholder="Acteur, ID ressource, ou contenu JSON…"
            value={t.q}
            onChange={(e) => t.setQ(e.target.value)}
            aria-label="Rechercher dans l'ensemble du journal d'audit (acteur, ressource, contenu du détail JSON)"
            aria-describedby="audit-search-hint"
          />
          <p id="audit-search-hint" className="mt-1 text-[11px] text-muted-foreground">
            Recherche serveur sur tous les champs structurés + le JSON <code>details</code>. Minimum
            2 caractères.
          </p>
        </div>
        <div className="w-full sm:w-56">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Type d&apos;action
          </label>
          <Select
            value={t.filters.action ?? ""}
            onChange={(e) =>
              t.setFilter("action", (e.target.value || undefined) as ActionFilter | undefined)
            }
            aria-label="Filtrer par type d'action"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-44">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Date de début
          </label>
          <Input
            type="date"
            value={t.filters.dateFrom ?? ""}
            onChange={(e) => t.setFilter("dateFrom", e.target.value || undefined)}
            aria-label="Date de début"
          />
        </div>
        <div className="w-full sm:w-44">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Date de fin
          </label>
          <Input
            type="date"
            value={t.filters.dateTo ?? ""}
            onChange={(e) => t.setFilter("dateTo", e.target.value || undefined)}
            aria-label="Date de fin"
          />
        </div>
      </div>

      {viewMode === "timeline" && timelineGroups ? (
        <div className="space-y-6">
          {isLoading ? (
            <Card>
              <CardContent className="p-6">
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="h-5 w-16 rounded bg-muted animate-pulse" />
                      <div className="h-4 flex-1 rounded bg-muted animate-pulse" />
                      <div className="h-3 w-14 rounded bg-muted animate-pulse" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : timelineGroups.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                {hasActive
                  ? "Aucun résultat — essayez d'élargir les filtres."
                  : "Aucune entrée d'audit pour le moment."}
              </CardContent>
            </Card>
          ) : (
            timelineGroups.map(([isoKey, { display, entries }]) => (
              <section key={isoKey} aria-labelledby={`tl-${isoKey}`}>
                <h2
                  id={`tl-${isoKey}`}
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {display}
                </h2>
                <Card>
                  <CardContent className="p-0 divide-y divide-border">
                    {entries.map((raw) => {
                      const log = raw as Record<string, unknown>;
                      const action = (log.action as string) ?? "";
                      const actor =
                        (log.actorDisplayName as string | null | undefined) ??
                        (log.actorId as string | undefined) ??
                        "";
                      const resourceType = (log.resourceType as string) ?? "";
                      const resourceId = (log.resourceId as string) ?? "";
                      const url = getResourceUrl(resourceType, resourceId);
                      const timestamp = (log.timestamp as string) ?? "";
                      const detail = log.details as Record<string, unknown> | undefined;
                      const style = getActionStyle(action);
                      return (
                        <article
                          key={(log.id as string) ?? `${actor}-${timestamp}`}
                          className="flex flex-col gap-1 px-4 py-3 text-sm"
                        >
                          <header className="flex flex-wrap items-center gap-2">
                            <Badge variant={style.variant}>{action}</Badge>
                            <span className="font-medium text-foreground">{actor}</span>
                            {url ? (
                              <Link
                                href={url}
                                className="text-muted-foreground hover:text-foreground hover:underline"
                              >
                                {resourceType} ·{" "}
                                <code className="font-mono text-[11px]">
                                  {resourceId.slice(0, 12)}
                                </code>
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">
                                {resourceType ? `${resourceType} · ` : ""}
                                <code className="font-mono text-[11px]">
                                  {resourceId.slice(0, 12)}
                                </code>
                              </span>
                            )}
                            <span className="ml-auto text-xs text-muted-foreground">
                              {timestamp ? formatDate(timestamp) : "—"}
                            </span>
                          </header>
                          {detail && Object.keys(detail).length > 0 && (
                            <AuditDiffView details={detail} />
                          )}
                        </article>
                      );
                    })}
                  </CardContent>
                </Card>
              </section>
            ))
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTable<Record<string, unknown>>
              aria-label="Journal d'audit"
              loading={isLoading}
              emptyMessage={
                hasActive
                  ? "Aucun résultat — essayez d'élargir les filtres."
                  : "Aucune entrée d'audit pour le moment."
              }
              data={filteredLogs}
              responsiveCards
              columns={
                [
                  {
                    key: "action",
                    header: "Action",
                    primary: true,
                    render: (log) => {
                      const action = (log.action as string) ?? "";
                      const style = getActionStyle(action);
                      return <Badge variant={style.variant}>{action}</Badge>;
                    },
                  },
                  {
                    key: "actor",
                    header: "Acteur",
                    render: (log) => {
                      const actor =
                        (log.actorDisplayName as string | null | undefined) ??
                        (log.actorId as string | undefined) ??
                        "";
                      return <span className="font-medium text-foreground">{actor}</span>;
                    },
                  },
                  {
                    key: "resource",
                    header: "Ressource",
                    render: (log) => {
                      const resourceType = (log.resourceType as string) ?? "";
                      const resourceId = (log.resourceId as string) ?? "";
                      const url = getResourceUrl(resourceType, resourceId);
                      const label = (
                        <span className="text-muted-foreground">
                          {resourceType ? `${resourceType} · ` : ""}
                          <code className="font-mono text-[11px]">{resourceId.slice(0, 12)}</code>
                        </span>
                      );
                      return url ? (
                        <Link
                          href={url}
                          className="text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {label}
                        </Link>
                      ) : (
                        label
                      );
                    },
                  },
                  {
                    key: "timestamp",
                    header: "Date",
                    render: (log) => (
                      <span className="text-muted-foreground whitespace-nowrap">
                        {log.timestamp ? formatDate(log.timestamp as string) : "-"}
                      </span>
                    ),
                  },
                ] as DataTableColumn<Record<string, unknown>>[]
              }
            />
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!isLoading && meta.totalPages > 1 ? (
        <nav
          aria-label="Pagination du journal d'audit"
          className="flex items-center justify-between text-sm text-muted-foreground"
        >
          <span aria-current="page">
            Page {meta.page} sur {meta.totalPages} ({meta.total} entrée{meta.total > 1 ? "s" : ""})
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
      ) : null}
    </div>
  );
}
