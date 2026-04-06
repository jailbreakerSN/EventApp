"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEvent } from "@/hooks/use-events";
import { useCheckinHistory } from "@/hooks/use-checkin";
import {
  ArrowLeft,
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export default function CheckinHistoryPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [page, setPage] = useState(1);

  const { data: eventData } = useEvent(eventId);
  const event = (eventData as { data?: Record<string, unknown> })?.data as Record<string, unknown> | undefined;
  const accessZones = (event?.accessZones as Array<{ id: string; name: string }>) ?? [];

  const { data, isLoading } = useCheckinHistory(eventId, {
    q: search || undefined,
    accessZoneId: zoneFilter || undefined,
    page,
    limit: 20,
  });

  const entries = (data as { data?: Array<Record<string, unknown>> })?.data ?? [];
  const meta = (data as { meta?: { page: number; totalPages: number; total: number } })?.meta;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(`/events/${eventId}/checkin`)} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Historique des check-ins</h1>
          <p className="text-sm text-gray-500">{(event?.title as string) ?? ""}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher par nom ou email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {accessZones.length > 0 && (
          <select
            value={zoneFilter}
            onChange={(e) => { setZoneFilter(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Toutes les zones</option>
            {accessZones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-gray-400 text-center py-12">Aucun check-in trouve</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b">
                <th className="px-4 py-3">Participant</th>
                <th className="px-4 py-3">Billet</th>
                <th className="px-4 py-3">Zone</th>
                <th className="px-4 py-3">Heure</th>
                <th className="px-4 py-3">Staff</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{(entry.participantName as string) ?? "—"}</div>
                    <div className="text-xs text-gray-400">{(entry.participantEmail as string) ?? ""}</div>
                  </td>
                  <td className="px-4 py-3">{entry.ticketTypeName as string}</td>
                  <td className="px-4 py-3">
                    {entry.accessZoneName ? (
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                        {entry.accessZoneName as string}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(entry.checkedInAt as string).toLocaleString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "short",
                    })}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{(entry.staffName as string) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <span className="text-sm text-gray-500">
              Page {meta.page} / {meta.totalPages} ({meta.total} resultats)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= meta.totalPages}
                className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
