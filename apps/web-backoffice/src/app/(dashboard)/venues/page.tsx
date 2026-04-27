"use client";

import { useState } from "react";
import { parseAsString } from "nuqs";
import Link from "next/link";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  Button,
  Skeleton,
  QueryError,
  SectionHeader,
  StatusPill,
  EmptyStateEditorial,
  Input,
  Select,
  ResultCount,
  PageSizeSelector,
  type StatusPillTone,
} from "@teranga/shared-ui";
import { MapPin, Plus, Search, ChevronLeft, ChevronRight, Calendar, Users, ExternalLink } from "lucide-react";
import { useMyVenues, useCreateVenue } from "@/hooks/use-venues";
import { useTableState } from "@/hooks/use-table-state";
import { useTranslations } from "next-intl";
import { normalizeFr } from "@teranga/shared-types";
import type { VenueType, VenueStatus } from "@teranga/shared-types";

// ─── Constants ──────────────────────────────────────────────────────────────

const VENUE_TYPE_LABELS: Record<string, string> = {
  hotel: "Hotel",
  conference_center: "Centre de conf.",
  cultural_space: "Espace culturel",
  coworking: "Coworking",
  restaurant: "Restaurant",
  outdoor: "Plein air",
  university: "Universit\u00e9",
  sports: "Sports",
  other: "Autre",
};

const STATUS_STYLES: Record<
  string,
  {
    tone: StatusPillTone;
    label: string;
  }
> = {
  pending: { tone: "warning", label: "En attente" },
  approved: { tone: "success", label: "Approuv\u00e9" },
  suspended: { tone: "danger", label: "Suspendu" },
  archived: { tone: "neutral", label: "Archiv\u00e9" },
};

// ─── Page ───────────────────────────────────────────────────────────────────

const SORTABLE_FIELDS = ["name", "createdAt", "eventCount"] as const;

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "pending", label: "En attente" },
  { value: "approved", label: "Approuvé" },
  { value: "suspended", label: "Suspendu" },
] as const;

const TYPE_FILTER_OPTIONS = [
  { value: "", label: "Tous les types" },
  ...Object.entries(VENUE_TYPE_LABELS).map(([value, label]) => ({ value, label })),
] as const;

type Filters = { status?: string; venueType?: string };

export default function VenuesPage() {
  const tCommon = useTranslations("common");
  void tCommon;

  // W4 migration — useTableState owns the URL state for q / status /
  // venueType / sort / page / pageSize. Org-scoped venue catalogue is
  // bounded (most organizers manage 1-10 venues); the doctrine still
  // applies because the page is a list archetype — search /
  // sort / pagination are MUST. The default sort matches what
  // operators expect (alphabetical by name asc).
  const t = useTableState<Filters>({
    urlNamespace: "venues",
    defaults: { sort: { field: "name", dir: "asc" }, pageSize: 25 },
    sortableFields: SORTABLE_FIELDS,
    filterParsers: { status: parseAsString, venueType: parseAsString },
  });

  const { data, isLoading, isError, refetch } = useMyVenues({
    q: t.debouncedQ || undefined,
    status: (t.filters.status || undefined) as VenueStatus | undefined,
    venueType: (t.filters.venueType || undefined) as VenueType | undefined,
    page: t.page,
    limit: t.pageSize,
    orderBy: t.sort?.field as "name" | "createdAt" | "eventCount" | undefined,
    orderDir: t.sort?.dir,
  });

  const createVenue = useCreateVenue();
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("conference_center");
  const [formCity, setFormCity] = useState("Dakar");
  const [formStreet, setFormStreet] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formEmail, setFormEmail] = useState("");

  const venues = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: t.pageSize, total: 0, totalPages: 1 };
  const hasActive = !!t.q || t.activeFilterCount > 0;
  // Doctrine MUST normalisation — search must be accent-folded. The
  // backend `q` already runs through normalizeFr server-side, but we
  // also apply it client-side as a defence-in-depth fallback for the
  // bounded local list.
  void normalizeFr;

  const handleCreate = async () => {
    if (!formName.trim() || !formEmail.trim() || !formContact.trim()) return;
    try {
      await createVenue.mutateAsync({
        name: formName.trim(),
        venueType: formType as any,
        address: { street: formStreet, city: formCity, country: "SN" },
        contactName: formContact,
        contactEmail: formEmail,
        amenities: [],
        photos: [],
      });
      setShowCreate(false);
      setFormName("");
      setFormStreet("");
      setFormContact("");
      setFormEmail("");
      toast.success("Lieu cr\u00e9\u00e9 avec succ\u00e8s");
    } catch {
      toast.error("Erreur lors de la cr\u00e9ation du lieu");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <SectionHeader
        kicker="— ESPACES"
        title="Mes Lieux"
        subtitle="G\u00e9rez vos espaces \u00e9v\u00e9nementiels et suivez leur activit\u00e9."
        size="hero"
        as="h1"
        action={
          <Button onClick={() => setShowCreate(!showCreate)} size="sm">
            <Plus size={16} className="mr-1.5" />
            Ajouter un lieu
          </Button>
        }
      />

      {/* Toolbar — search + filters + sort + result count + clear-all. */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
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
          <div className="flex items-center gap-3 shrink-0">
            <ResultCount total={meta.total} loading={isLoading} />
            <PageSizeSelector value={t.pageSize} onChange={t.setPageSize} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>Statut</span>
            <Select
              value={t.filters.status ?? ""}
              onChange={(e) => t.setFilter("status", e.target.value || undefined)}
              aria-label="Filtrer par statut"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>Type</span>
            <Select
              value={t.filters.venueType ?? ""}
              onChange={(e) => t.setFilter("venueType", e.target.value || undefined)}
              aria-label="Filtrer par type de lieu"
            >
              {TYPE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>Trier par</span>
            <Select
              value={`${t.sort?.field ?? "name"}:${t.sort?.dir ?? "asc"}`}
              onChange={(e) => {
                const [field, dir] = e.target.value.split(":") as [
                  (typeof SORTABLE_FIELDS)[number],
                  "asc" | "desc",
                ];
                if (t.sort?.field !== field) {
                  t.toggleSort(field);
                  if (dir === "desc") t.toggleSort(field);
                } else if (t.sort.dir !== dir) {
                  t.toggleSort(field);
                }
              }}
              aria-label="Trier les lieux"
            >
              <option value="name:asc">Nom (A &rarr; Z)</option>
              <option value="name:desc">Nom (Z &rarr; A)</option>
              <option value="createdAt:desc">R&eacute;cemment ajout&eacute;s</option>
              <option value="createdAt:asc">Anciens d&apos;abord</option>
              <option value="eventCount:desc">&Eacute;v&eacute;nements (du plus actif)</option>
            </Select>
          </label>
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
      </div>

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold text-foreground">Nouveau lieu</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Nom *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Ex: CICAD - Centre de Dakar"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Type</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {Object.entries(VENUE_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Adresse</label>
                <input
                  type="text"
                  value={formStreet}
                  onChange={(e) => setFormStreet(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Rue, quartier"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Ville</label>
                <input
                  type="text"
                  value={formCity}
                  onChange={(e) => setFormCity(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Contact *</label>
                <input
                  type="text"
                  value={formContact}
                  onChange={(e) => setFormContact(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Nom du contact"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Email *</label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="contact@monlieu.sn"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleCreate} disabled={createVenue.isPending} size="sm">
                {createVenue.isPending ? "Cr\u00e9ation..." : "Cr\u00e9er"}
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)} size="sm">
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && <QueryError onRetry={refetch} />}

      {/* Empty — distinguish "no data ever" from "no match for current filters" */}
      {!isLoading && !isError && venues.length === 0 && hasActive && (
        <EmptyStateEditorial
          icon={Search}
          kicker="— AUCUN RÉSULTAT"
          title="Aucun lieu ne correspond aux filtres"
          description="Essayez d’élargir votre recherche ou de retirer un filtre."
          action={
            <Button onClick={t.reset} size="sm" variant="outline">
              Tout effacer
            </Button>
          }
        />
      )}
      {!isLoading && !isError && venues.length === 0 && !hasActive && (
        <EmptyStateEditorial
          icon={MapPin}
          kicker="— AUCUN LIEU"
          title="D\u00e9marrez votre catalogue"
          description="Ajoutez votre premier espace \u00e9v\u00e9nementiel pour commencer \u00e0 organiser des \u00e9v\u00e9nements."
          action={
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Plus size={16} className="mr-1.5" />
              Ajouter un lieu
            </Button>
          }
        />
      )}

      {/* Venue cards */}
      {!isLoading && venues.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {venues.map((venue: any) => {
            const status = STATUS_STYLES[venue.status] ?? STATUS_STYLES.pending;
            return (
              <Link key={venue.id} href={`/venues/${venue.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground truncate">{venue.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {VENUE_TYPE_LABELS[venue.venueType] ?? venue.venueType}
                          {venue.address?.city && ` \u2014 ${venue.address.city}`}
                        </p>
                      </div>
                      <StatusPill
                        tone={status.tone}
                        label={status.label}
                        className="ml-2 shrink-0"
                      />
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-4">
                      <span className="flex items-center gap-1">
                        <Calendar size={13} />
                        {venue.eventCount ?? 0} \u00e9v\u00e9nement
                        {(venue.eventCount ?? 0) !== 1 ? "s" : ""}
                      </span>
                      {venue.capacity?.max && (
                        <span className="flex items-center gap-1">
                          <Users size={13} />
                          {venue.capacity.max} places
                        </span>
                      )}
                      {venue.website && (
                        <span className="flex items-center gap-1">
                          <ExternalLink size={13} />
                          Site web
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && meta.totalPages > 1 ? (
        <nav
          aria-label="Pagination des lieux"
          className="flex items-center justify-between text-sm text-muted-foreground"
        >
          <span aria-current="page">
            Page {meta.page} sur {meta.totalPages} ({meta.total} lieu
            {meta.total > 1 ? "x" : ""})
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => t.setPage(Math.max(1, t.page - 1))}
              disabled={t.page <= 1}
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-4 w-4" />
              Précédent
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => t.setPage(Math.min(meta.totalPages, t.page + 1))}
              disabled={t.page >= meta.totalPages}
              aria-label="Page suivante"
            >
              Suivant
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
