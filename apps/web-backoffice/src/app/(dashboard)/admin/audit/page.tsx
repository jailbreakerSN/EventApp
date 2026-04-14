"use client";

import { useState } from "react";
import Link from "next/link";
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
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { useAdminAuditLogs } from "@/hooks/use-admin";

const ACTION_OPTIONS = [
  { value: "", label: "Toutes les actions" },
  { value: "registration", label: "Inscriptions" },
  { value: "event", label: "Événements" },
  { value: "organization", label: "Organisations" },
  { value: "venue", label: "Lieux" },
  { value: "user", label: "Utilisateurs" },
  { value: "payment", label: "Paiements" },
] as const;

const ACTION_GROUP_STYLES: Record<string, { variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline"; }> = {
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
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading } = useAdminAuditLogs({
    page,
    limit: 20,
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  });

  const logs = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 };

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

      {/* Header */}
      <h1 className="text-2xl font-bold text-foreground">Journal d&apos;audit</h1>

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
