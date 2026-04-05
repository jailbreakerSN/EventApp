"use client";

import { useState } from "react";
import Link from "next/link";
import { useEvents } from "@/hooks/use-events";
import { formatDate } from "@/lib/utils";
import { Search, Plus, ChevronLeft, ChevronRight, Calendar, MapPin, Users } from "lucide-react";
import type { EventSearchQuery } from "@teranga/shared-types";

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: "Brouillon", className: "bg-gray-100 text-gray-700" },
  published: { label: "Publié", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Annulé", className: "bg-red-100 text-red-700" },
  archived: { label: "Archivé", className: "bg-yellow-100 text-yellow-700" },
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

  const { data, isLoading, isError } = useEvents({
    q: search || undefined,
    category: (category || undefined) as EventSearchQuery["category"],
    page,
    limit,
  });

  const events = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Événements</h1>
        <Link
          href="/events/new"
          className="inline-flex items-center gap-2 bg-[#1A1A2E] text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[#16213E] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Créer un événement
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher un événement..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
          />
        </div>
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1); }}
          className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E] bg-white"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-400">
          Chargement des événements...
        </div>
      ) : isError ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-red-500">
          Erreur lors du chargement. Veuillez réessayer.
        </div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-400">
          {search || category
            ? "Aucun événement ne correspond à vos filtres."
            : "Aucun événement pour le moment. Créez votre premier événement."}
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500 font-medium">
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
                    const status = STATUS_LABELS[event.status] ?? STATUS_LABELS.draft;
                    return (
                      <tr key={event.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-gray-900 max-w-[250px] truncate">
                          {event.title}
                        </td>
                        <td className="px-6 py-4 text-gray-600 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDate(event.startDate)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600 whitespace-nowrap">
                          {event.location?.city ? (
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5" />
                              {event.location.city}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-gray-600 capitalize">
                          {event.category ?? "—"}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-gray-600">
                          <span className="inline-flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5" />
                            {event.registeredCount ?? 0}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/events/${event.id}`}
                            className="text-[#1A1A2E] hover:underline font-medium text-sm"
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
            <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
              <span>
                Page {page} sur {totalPages} ({meta?.total ?? 0} résultat{(meta?.total ?? 0) > 1 ? "s" : ""})
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" /> Précédent
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Suivant <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
