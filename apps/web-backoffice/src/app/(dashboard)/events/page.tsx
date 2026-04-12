"use client";

import { useState } from "react";
import Link from "next/link";
import { useEvents } from "@/hooks/use-events";
import { formatDate } from "@/lib/utils";
import { Search, Plus, ChevronLeft, ChevronRight, Calendar, MapPin, Users } from "lucide-react";
import { Select, Skeleton, QueryError, Badge, getStatusVariant } from "@teranga/shared-ui";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  published: "Publié",
  cancelled: "Annulé",
  archived: "Archivé",
};

const CATEGORY_OPTIONS = [
  { value: "", label: "Toutes les catégories" },
  { value: "conference", label: "Conférence" },
  { value: "workshop", label: "Atelier" },
  { value: "meetup", label: "Meetup" },
  { value: "concert", label: "Concert" },
  { value: "festival", label: "Festival" },
  { value: "sport", label: "Sport" },
  { value: "other", label: "Autre" },
];

export default function EventsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;

  const { data, isLoading, isError, refetch } = useEvents({
    page,
    limit,
  });

  const allEvents = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  // Client-side search and category filter
  const events = allEvents.filter((event) => {
    const matchesSearch = !search || event.title.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !category || event.category === category;
    return matchesSearch && matchesCategory;
  });

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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Rechercher un événement..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Rechercher un événement"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <Select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
          aria-label="Filtrer par catégorie"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground font-medium">
                  <th className="px-6 py-3">Événement</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Lieu</th>
                  <th className="px-6 py-3">Catégorie</th>
                  <th className="px-6 py-3">Statut</th>
                  <th className="px-6 py-3 text-right">Inscrits</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-6 py-4">
                      <Skeleton variant="text" className="h-4 w-40" />
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton variant="text" className="h-4 w-24" />
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton variant="text" className="h-4 w-20" />
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton variant="text" className="h-4 w-16" />
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton variant="text" className="h-5 w-16 rounded-full" />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Skeleton variant="text" className="h-4 w-8 ml-auto" />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Skeleton variant="text" className="h-4 w-10 ml-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : isError ? (
        <QueryError onRetry={refetch} />
      ) : events.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          {search || category
            ? "Aucun événement ne correspond à vos filtres."
            : "Aucun événement pour le moment. Créez votre premier événement."}
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground font-medium">
                    <th className="px-6 py-3">Événement</th>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3">Lieu</th>
                    <th className="px-6 py-3">Catégorie</th>
                    <th className="px-6 py-3">Statut</th>
                    <th className="px-6 py-3 text-right">Inscrits</th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const statusLabel = STATUS_LABELS[event.status] ?? STATUS_LABELS.draft;
                    return (
                      <tr
                        key={event.id}
                        className="border-b border-border/50 hover:bg-muted/50 transition-colors"
                      >
                        <td className="px-6 py-4 font-medium text-foreground max-w-[250px] truncate">
                          {event.title}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDate(event.startDate)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                          {event.location?.city ? (
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5" />
                              {event.location.city}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground capitalize">
                          {event.category ?? "—"}
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant={getStatusVariant(event.status)}>{statusLabel}</Badge>
                        </td>
                        <td className="px-6 py-4 text-right text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5" />
                            {event.registeredCount ?? 0}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/events/${event.id}`}
                            className="text-primary hover:underline font-medium text-sm"
                          >
                            Voir
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav
              className="flex items-center justify-between mt-4 text-sm text-muted-foreground"
              aria-label="Pagination"
            >
              <span aria-current="page">
                Page {page} sur {totalPages} ({meta?.total ?? 0} résultat
                {(meta?.total ?? 0) > 1 ? "s" : ""})
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  aria-label="Page précédente"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Précédent
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  aria-label="Page suivante"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Suivant <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
