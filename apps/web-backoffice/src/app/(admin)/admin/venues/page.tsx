"use client";

import { parseAsString } from "nuqs";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  Select,
  Input,
  Badge,
  getStatusVariant,
  Button,
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
import { useTableState } from "@/hooks/use-table-state";
import { MapPin, Search, ShieldCheck, Ban, CheckCircle } from "lucide-react";
import { useApproveVenue, useSuspendVenue, useReactivateVenue } from "@/hooks/use-venues";
import { useAdminVenues } from "@/hooks/use-admin";
import type { Venue, VenueType, VenueStatus } from "@teranga/shared-types";
import { useTranslations } from "next-intl";
import { CsvExportButton } from "@/components/admin/csv-export-button";

// ─── Constants ──────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: "", label: "Tous les types" },
  { value: "hotel", label: "Hotel" },
  { value: "conference_center", label: "Centre de conference" },
  { value: "cultural_space", label: "Espace culturel" },
  { value: "coworking", label: "Coworking" },
  { value: "restaurant", label: "Restaurant" },
  { value: "outdoor", label: "Plein air" },
  { value: "university", label: "Universite" },
  { value: "sports", label: "Sport" },
  { value: "other", label: "Autre" },
] as const;

const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "pending", label: "En attente" },
  { value: "approved", label: "Approuve" },
  { value: "suspended", label: "Suspendu" },
] as const;

const TYPE_LABELS: Record<string, string> = {
  hotel: "Hotel",
  conference_center: "Conference",
  cultural_space: "Culturel",
  coworking: "Coworking",
  restaurant: "Restaurant",
  outdoor: "Plein air",
  university: "Universite",
  sports: "Sport",
  other: "Autre",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  approved: "Approuve",
  suspended: "Suspendu",
  archived: "Archive",
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminVenuesPage() {
  const tCommon = useTranslations("common");
  void tCommon;
  const router = useRouter();
  // Hydrate the status filter from the URL so deep-links from the admin
  // inbox (e.g. `/admin/venues?status=pending` from the "X lieux en
  // attente de modération" signal in `admin.service.ts:getInboxSignals`)
  // actually apply the filter instead of silently showing the whole list.
  const searchParams = useSearchParams();
  const initialStatus = searchParams?.get("status") ?? "";

  // W3 migration — useTableState owns URL state. Inbox deep-link contract
  // preserved (`/admin/venues?status=pending` from the
  // "X lieux en attente de modération" signal still hydrates the filtered
  // view via defaults.filters.status).
  const t = useTableState<{ venueType?: string; status?: string }>({
    urlNamespace: "venues",
    defaults: {
      sort: null,
      pageSize: 25,
      filters: {
        status: STATUS_OPTIONS.some((o) => o.value === initialStatus)
          ? initialStatus || undefined
          : undefined,
      },
    },
    sortableFields: [],
    filterParsers: { venueType: parseAsString, status: parseAsString },
  });

  // Hits /v1/admin/venues — surfaces every status (pending / approved /
  // suspended / archived). The previous implementation called the public
  // `useVenues()` hook which hits /v1/venues (approved-only, silently
  // drops `status`), so deep-links from the inbox like
  // `/admin/venues?status=pending` rendered approved venues only.
  const { data, isLoading } = useAdminVenues({
    q: t.debouncedQ || undefined,
    venueType: (t.filters.venueType || undefined) as VenueType | undefined,
    status: (t.filters.status || undefined) as VenueStatus | undefined,
    page: t.page,
    limit: t.pageSize,
  });

  const venues: Venue[] = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: t.pageSize, total: 0, totalPages: 1 };
  const hasActive = t.activeFilterCount > 0 || !!t.q;

  const approveVenue = useApproveVenue();
  const suspendVenue = useSuspendVenue();
  const reactivateVenue = useReactivateVenue();

  const handleApprove = (venue: Venue) => {
    if (!window.confirm(`Voulez-vous approuver le lieu "${venue.name}" ?`)) return;
    approveVenue.mutate(venue.id);
  };

  const handleToggleStatus = (venue: Venue) => {
    if (venue.status === "suspended") {
      if (!window.confirm(`Voulez-vous reactiver le lieu "${venue.name}" ?`)) return;
      reactivateVenue.mutate(venue.id);
    } else {
      if (!window.confirm(`Voulez-vous suspendre le lieu "${venue.name}" ?`)) return;
      suspendVenue.mutate(venue.id);
    }
  };

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
            <BreadcrumbPage>Lieux</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MapPin className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Gestion des lieux</h1>
        </div>
        <div className="flex items-center gap-3">
          <ResultCount total={meta.total} loading={isLoading} />
          <PageSizeSelector value={t.pageSize} onChange={t.setPageSize} />
          <CsvExportButton
            resource="venues"
            filters={t.filters.status ? `status=${encodeURIComponent(t.filters.status)}` : ""}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            role="searchbox"
            placeholder="Rechercher par nom..."
            value={t.q}
            onChange={(e) => t.setQ(e.target.value)}
            className="pl-9"
            aria-label="Rechercher des lieux"
          />
        </div>

        <div className="flex gap-3">
          <div>
            <label
              htmlFor="type-filter"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Type
            </label>
            <Select
              id="type-filter"
              value={t.filters.venueType ?? ""}
              onChange={(e) => t.setFilter("venueType", e.target.value || undefined)}
              aria-label="Filtrer par type"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label
              htmlFor="status-filter"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Statut
            </label>
            <Select
              id="status-filter"
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
        </div>
        {hasActive ? (
          <button
            type="button"
            onClick={t.reset}
            className="self-end text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Tout effacer
          </button>
        ) : null}
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <DataTable<Venue & Record<string, unknown>>
            aria-label="Liste des lieux"
            emptyMessage={
              hasActive
                ? "Aucun résultat — essayez d'élargir les filtres."
                : "Aucun lieu trouvé"
            }
            responsiveCards
            loading={isLoading}
            data={venues as (Venue & Record<string, unknown>)[]}
            // Whole-row click → venue detail. Middle-click on the name
            // Link opens in a new tab.
            onRowClick={(v) => router.push(`/admin/venues/${encodeURIComponent(v.id)}`)}
            columns={
              [
                {
                  key: "name",
                  header: "Nom",
                  primary: true,
                  render: (venue) => (
                    <div>
                      <Link
                        href={`/admin/venues/${encodeURIComponent(venue.id)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {venue.name}
                      </Link>
                      {venue.slug && (
                        <p className="text-xs text-muted-foreground font-mono">{venue.slug}</p>
                      )}
                    </div>
                  ),
                },
                {
                  key: "venueType",
                  header: "Type",
                  render: (venue) => (
                    <Badge variant="info">{TYPE_LABELS[venue.venueType] ?? venue.venueType}</Badge>
                  ),
                },
                {
                  key: "city",
                  header: "Ville",
                  render: (venue) => (
                    <span className="text-muted-foreground">
                      {venue.address.city}, {venue.address.country}
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Statut",
                  render: (venue) => (
                    <Badge variant={getStatusVariant(venue.status)}>
                      {STATUS_LABELS[venue.status] ?? venue.status}
                    </Badge>
                  ),
                },
                {
                  key: "eventCount",
                  header: "Événements",
                  hideOnMobile: true,
                  render: (venue) => (
                    <span className="font-medium text-foreground">{venue.eventCount}</span>
                  ),
                },
                {
                  key: "contactEmail",
                  header: "Contact",
                  hideOnMobile: true,
                  render: (venue) => (
                    <span className="text-muted-foreground text-xs">{venue.contactEmail}</span>
                  ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  // Approve / suspend buttons own their clicks — don't
                  // navigate to the detail page on top of them.
                  stopRowNavigation: true,
                  render: (venue) => (
                    <div className="flex items-center justify-end gap-2">
                      {venue.status === "pending" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleApprove(venue)}
                          disabled={approveVenue.isPending}
                          aria-label={`Approuver ${venue.name}`}
                        >
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                          Approuver
                        </Button>
                      )}
                      {venue.status !== "archived" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleStatus(venue)}
                          disabled={suspendVenue.isPending || reactivateVenue.isPending}
                          aria-label={
                            venue.status === "suspended"
                              ? `Reactiver ${venue.name}`
                              : `Suspendre ${venue.name}`
                          }
                        >
                          {venue.status === "suspended" ? (
                            <>
                              <CheckCircle className="h-3.5 w-3.5 mr-1" />
                              Reactiver
                            </>
                          ) : (
                            <>
                              <Ban className="h-3.5 w-3.5 mr-1" />
                              Suspendre
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  ),
                },
              ] as DataTableColumn<Venue & Record<string, unknown>>[]
            }
          />
        </CardContent>
      </Card>

      {/* Pagination */}
      {!isLoading && meta.totalPages > 1 ? (
        <nav
          aria-label="Pagination des lieux"
          className="flex items-center justify-between"
        >
          <p className="text-sm text-muted-foreground" aria-current="page">
            Page {meta.page} sur {meta.totalPages} ({meta.total} lieu
            {meta.total > 1 ? "x" : ""})
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => t.setPage(Math.max(1, t.page - 1))}
              disabled={t.page <= 1}
              aria-label="Page précédente"
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => t.setPage(Math.min(meta.totalPages, t.page + 1))}
              disabled={t.page >= meta.totalPages}
              aria-label="Page suivante"
            >
              Suivant
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
