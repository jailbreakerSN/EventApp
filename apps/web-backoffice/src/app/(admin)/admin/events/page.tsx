"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
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
} from "@teranga/shared-ui";
import { ChevronLeft, ChevronRight, Eye, Users, Building } from "lucide-react";
import { useAdminEvents, useAdminOrganizations } from "@/hooks/use-admin";
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
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const { data, isLoading } = useAdminEvents({
    page,
    limit: 20,
    ...(status ? { status } : {}),
  });

  const events = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 };

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
          <div className="w-full sm:w-56">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              aria-label="Filtrer par statut"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <DataTable<Record<string, unknown>>
            aria-label="Liste des événements"
            emptyMessage="Aucun événement trouvé"
            responsiveCards
            loading={isLoading}
            data={events as Record<string, unknown>[]}
            columns={
              [
                {
                  key: "title",
                  header: "Titre",
                  primary: true,
                  render: (event) => (
                    <span className="font-medium text-foreground">{event.title as string}</span>
                  ),
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
                  render: (event) => (
                    <Link
                      href={`/events/${event.id as string}`}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      aria-label={`Voir ${event.title as string}`}
                    >
                      <Eye className="h-4 w-4" />
                      <span className="hidden sm:inline">Voir</span>
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
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {meta.page} sur {meta.totalPages} ({meta.total} événement
            {meta.total > 1 ? "s" : ""})
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
