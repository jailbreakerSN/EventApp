"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CsvExportButton } from "@/components/admin/csv-export-button";
import { SavedViewsBar } from "@/components/admin/saved-views-bar";
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
} from "@teranga/shared-ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAdminAuditLogs } from "@/hooks/use-admin";
import { useTranslations } from "next-intl";

const ACTION_OPTIONS = [
  { value: "", label: "Toutes les actions" },
  { value: "registration", label: "Inscriptions" },
  { value: "event", label: "Événements" },
  { value: "organization", label: "Organisations" },
  { value: "venue", label: "Lieux" },
  { value: "user", label: "Utilisateurs" },
  { value: "payment", label: "Paiements" },
] as const;

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
  return new Date(timestamp).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminAuditPage() {
  const tCommon = useTranslations("common");
  void tCommon;

  // Phase 7 — deep-link support. Inbox cards + detail pages route to
  // this page with pre-filtered query strings (e.g. ?actorId=xyz,
  // ?resourceType=organization, ?action=payment.failed). We initialise
  // state from the URL so those links land in the filtered view.
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState(searchParams?.get("action") ?? "");
  const [actorIdFilter, setActorIdFilter] = useState(searchParams?.get("actorId") ?? "");
  // T2.6 — server-side free-text search over `details` JSON + action +
  // actor + resource ids. The input is debounced via a local mirror
  // (`searchInput`) so each keystroke doesn't refire the query; 300ms
  // is the sweet spot between "feels live" and "doesn't spam Firestore".
  const [searchInput, setSearchInput] = useState(searchParams?.get("search") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(searchInput);
  const [resourceTypeFilter, setResourceTypeFilter] = useState(
    searchParams?.get("resourceType") ?? "",
  );
  const [dateFrom, setDateFrom] = useState(searchParams?.get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState(searchParams?.get("dateTo") ?? "");
  // T2.6 — UI viewport: "table" = flat paginated list (default);
  // "timeline" = grouped by day with a chronological ruler.
  const [viewMode, setViewMode] = useState<"table" | "timeline">(
    searchParams?.get("view") === "timeline" ? "timeline" : "table",
  );

  // Debounce the search input → query value.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const { data, isLoading } = useAdminAuditLogs({
    page,
    limit: 20,
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(actorIdFilter ? { actorId: actorIdFilter } : {}),
    ...(resourceTypeFilter ? { resourceType: resourceTypeFilter } : {}),
    ...(debouncedSearch.trim().length >= 2 ? { search: debouncedSearch.trim() } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  });

  const logs = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 };

  // T2.6 — search is now server-side; rows arriving here are already
  // the final filtered set for the current page. The local
  // `filteredLogs` alias is preserved so the table render code below
  // doesn't need to change.
  const filteredLogs = logs;

  // T2.6 — timeline view: group rows by the local calendar day.
  // Firestore orders by timestamp desc so the groups are already
  // sorted; we just bucket them.
  const timelineGroups = useMemo(() => {
    if (viewMode !== "timeline") return null;
    const groups = new Map<string, typeof filteredLogs>();
    for (const log of filteredLogs) {
      const ts = (log as { timestamp?: string }).timestamp ?? "";
      if (!ts) continue;
      const day = new Date(ts).toLocaleDateString("fr-SN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const bucket = groups.get(day);
      if (bucket) bucket.push(log);
      else groups.set(day, [log]);
    }
    return Array.from(groups.entries());
  }, [filteredLogs, viewMode]);

  // Build the querystring passed to the CSV export so the exported file
  // mirrors whatever the admin is currently looking at.
  const exportFilters = useMemo(() => {
    const params = new URLSearchParams();
    if (actionFilter) params.set("action", actionFilter);
    if (actorIdFilter) params.set("actorId", actorIdFilter);
    if (resourceTypeFilter) params.set("resourceType", resourceTypeFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  }, [actionFilter, actorIdFilter, resourceTypeFilter, dateFrom, dateTo]);

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

      {/* Header + export action + view toggle (T2.6) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">Journal d&apos;audit</h1>
        <div className="flex items-center gap-2">
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

      {/* T3.2 — Saved views chip bar. */}
      <SavedViewsBar surfaceKey="admin-audit" />

      {/* Active-filter breadcrumb pills (Phase 7 — visible state). */}
      {(actorIdFilter || resourceTypeFilter) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Filtres :</span>
          {actorIdFilter && (
            <Badge variant="outline" className="gap-1.5 py-1">
              actor = <code className="font-mono text-[10px]">{actorIdFilter.slice(0, 12)}…</code>
              <button
                type="button"
                onClick={() => {
                  setActorIdFilter("");
                  setPage(1);
                }}
                aria-label="Retirer le filtre actor"
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </Badge>
          )}
          {resourceTypeFilter && (
            <Badge variant="outline" className="gap-1.5 py-1">
              type = {resourceTypeFilter}
              <button
                type="button"
                onClick={() => {
                  setResourceTypeFilter("");
                  setPage(1);
                }}
                aria-label="Retirer le filtre type"
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </Badge>
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
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
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
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
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
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            aria-label="Date de début"
          />
        </div>
        <div className="w-full sm:w-44">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Date de fin
          </label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            aria-label="Date de fin"
          />
        </div>
      </div>

      {viewMode === "timeline" && timelineGroups ? (
        <div className="space-y-6">
          {timelineGroups.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Aucune entrée sur cette période.
              </CardContent>
            </Card>
          ) : (
            timelineGroups.map(([day, entries]) => (
              <section key={day} aria-labelledby={`tl-${day}`}>
                <h2
                  id={`tl-${day}`}
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {day}
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
                      return (
                        <div
                          key={(log.id as string) ?? `${action}-${log.timestamp}`}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant={getActionStyle(action).variant}>{action}</Badge>
                            <span className="text-muted-foreground">
                              par{" "}
                              <span className="text-foreground font-medium">{actor || "—"}</span>
                            </span>
                            {resourceType && (
                              <span className="text-muted-foreground">
                                sur{" "}
                                {url ? (
                                  <Link
                                    href={url}
                                    className="text-foreground font-medium hover:underline"
                                  >
                                    {resourceType} {resourceId.slice(0, 8)}
                                  </Link>
                                ) : (
                                  <span className="text-foreground font-medium">
                                    {resourceType} {resourceId.slice(0, 8)}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                          <time
                            dateTime={log.timestamp as string}
                            className="text-xs text-muted-foreground whitespace-nowrap"
                          >
                            {new Date(log.timestamp as string).toLocaleTimeString("fr-SN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </section>
            ))
          )}
        </div>
      ) : (
        /* Table */
        <Card>
          <CardContent className="p-0">
            <DataTable<Record<string, unknown>>
              aria-label="Journal d'audit"
              emptyMessage="Aucune entrée trouvée"
              responsiveCards
              loading={isLoading}
              data={filteredLogs as Record<string, unknown>[]}
              columns={
                [
                  {
                    key: "action",
                    header: "Action",
                    primary: true,
                    render: (log) => (
                      <Badge variant={getActionStyle(log.action as string).variant}>
                        {log.action as string}
                      </Badge>
                    ),
                  },
                  {
                    key: "actor",
                    header: "Acteur",
                    render: (log) => {
                      // Prefer the denormalized actorDisplayName (T1.1); fall
                      // back to the truncated actorId for historical rows
                      // written before the denorm landed. Render the actorId
                      // underneath in a muted font when both are present so
                      // operators can still copy the raw UID from the UI.
                      const displayName = log.actorDisplayName as string | null | undefined;
                      const actorId = (log.actorId as string) ?? "";
                      if (displayName) {
                        return (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-foreground">
                              {displayName}
                            </span>
                            <code className="font-mono text-[10px] text-muted-foreground">
                              {actorId.slice(0, 12)}
                              {actorId.length > 12 ? "…" : ""}
                            </code>
                          </div>
                        );
                      }
                      return (
                        <span className="font-mono text-xs text-muted-foreground">
                          {actorId.slice(0, 12)}
                          {actorId.length > 12 ? "…" : ""}
                        </span>
                      );
                    },
                  },
                  {
                    key: "resource",
                    header: "Ressource",
                    hideOnMobile: true,
                    render: (log) => {
                      const type = (log.resourceType as string) ?? "";
                      const id = (log.resourceId as string) ?? "";
                      const url = getResourceUrl(type, id);
                      const label = (
                        <span className="text-muted-foreground">
                          <span className="font-medium text-foreground">{type}</span>
                          {id ? (
                            <span className="ml-1 font-mono text-xs">
                              {id.slice(0, 12)}
                              {id.length > 12 ? "…" : ""}
                            </span>
                          ) : null}
                        </span>
                      );
                      return url ? (
                        <Link
                          href={url}
                          className="hover:underline hover:text-teranga-gold"
                          title={`Ouvrir ${type} ${id}`}
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
      {!isLoading && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {meta.page} sur {meta.totalPages} ({meta.total} entrée{meta.total > 1 ? "s" : ""})
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.page <= 1}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-4 w-4" />
              Précédent
            </button>
            <button
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={meta.page >= meta.totalPages}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Page suivante"
            >
              Suivant
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
