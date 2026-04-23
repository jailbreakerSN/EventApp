"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CsvExportButton } from "@/components/admin/csv-export-button";
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
  const [resourceTypeFilter, setResourceTypeFilter] = useState(
    searchParams?.get("resourceType") ?? "",
  );
  const [dateFrom, setDateFrom] = useState(searchParams?.get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState(searchParams?.get("dateTo") ?? "");

  const { data, isLoading } = useAdminAuditLogs({
    page,
    limit: 20,
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(actorIdFilter ? { actorId: actorIdFilter } : {}),
    ...(resourceTypeFilter ? { resourceType: resourceTypeFilter } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  });

  const logs = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 };

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
              <Link href="/dashboard">Tableau de bord</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
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

      {/* Header + export action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">Journal d&apos;audit</h1>
        <CsvExportButton resource="audit-logs" filters={exportFilters} />
      </div>

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <DataTable<Record<string, unknown>>
            aria-label="Journal d'audit"
            emptyMessage="Aucune entrée trouvée"
            responsiveCards
            loading={isLoading}
            data={logs as Record<string, unknown>[]}
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
                  key: "actorId",
                  header: "Acteur",
                  render: (log) => (
                    <span className="font-mono text-xs text-muted-foreground">
                      {(log.actorId as string)?.slice(0, 12)}...
                    </span>
                  ),
                },
                {
                  key: "resource",
                  header: "Ressource",
                  hideOnMobile: true,
                  render: (log) => (
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {log.resourceType as string}
                      </span>
                      {log.resourceId ? (
                        <span className="ml-1 font-mono text-xs">
                          {(log.resourceId as string).slice(0, 12)}...
                        </span>
                      ) : null}
                    </span>
                  ),
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
