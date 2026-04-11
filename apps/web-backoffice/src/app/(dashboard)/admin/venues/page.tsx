"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  Select,
  Input,
  Badge,
  Button,
  Skeleton,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { MapPin, Search, ShieldCheck, Ban, CheckCircle, CalendarDays } from "lucide-react";
import {
  useVenues,
  useApproveVenue,
  useSuspendVenue,
  useReactivateVenue,
} from "@/hooks/use-venues";
import type { Venue, VenueType, VenueStatus } from "@teranga/shared-types";

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

const STATUS_BADGE_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  suspended: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  archived: "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  approved: "Approuve",
  suspended: "Suspendu",
  archived: "Archive",
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminVenuesPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useVenues({
    q: search || undefined,
    venueType: (typeFilter || undefined) as VenueType | undefined,
    status: (statusFilter || undefined) as VenueStatus | undefined,
    page,
    limit,
  });

  const venues: Venue[] = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit, total: 0, totalPages: 1 };

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
            <BreadcrumbPage>Lieux</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center gap-3">
        <MapPin className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Gestion des lieux</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
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
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
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
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
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
        </div>
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Liste des lieux">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nom</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ville</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Statut</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                    <CalendarDays className="inline h-4 w-4" aria-label="Nombre d'événements" />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Contact</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-40 mb-1" />
                        <Skeleton className="h-3 w-24" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-5 w-20" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-5 w-20" />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Skeleton className="mx-auto h-4 w-8" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-32" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-8 w-28 ml-auto" />
                      </td>
                    </tr>
                  ))}

                {!isLoading && venues.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      <MapPin className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      Aucun lieu trouve
                    </td>
                  </tr>
                )}

                {!isLoading &&
                  venues.map((venue) => (
                    <tr
                      key={venue.id}
                      className="border-b border-border hover:bg-muted/30 transition-colors"
                    >
                      {/* Name */}
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{venue.name}</p>
                        {venue.slug && (
                          <p className="text-xs text-muted-foreground font-mono">{venue.slug}</p>
                        )}
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3">
                        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          {TYPE_LABELS[venue.venueType] ?? venue.venueType}
                        </Badge>
                      </td>

                      {/* City */}
                      <td className="px-4 py-3 text-muted-foreground">
                        {venue.address.city}, {venue.address.country}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            STATUS_BADGE_STYLES[venue.status] ?? STATUS_BADGE_STYLES.pending
                          }
                        >
                          {STATUS_LABELS[venue.status] ?? venue.status}
                        </Badge>
                      </td>

                      {/* Event count */}
                      <td className="px-4 py-3 text-center font-medium text-foreground">
                        {venue.eventCount}
                      </td>

                      {/* Contact */}
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {venue.contactEmail}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
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
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {!isLoading && meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} sur {meta.totalPages} ({meta.total} lieu
            {meta.total > 1 ? "x" : ""})
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Page precedente"
            >
              Precedent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={page >= meta.totalPages}
              aria-label="Page suivante"
            >
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
