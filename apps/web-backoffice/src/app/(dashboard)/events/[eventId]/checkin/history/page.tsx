"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEvent } from "@/hooks/use-events";
import { useCheckinHistory } from "@/hooks/use-checkin";
import { Badge, DataTable, type DataTableColumn } from "@teranga/shared-ui";
import {
  ArrowLeft,
  Search,
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
        <button onClick={() => router.push(`/events/${eventId}/checkin`)} className="p-2 rounded-lg hover:bg-accent" aria-label="Retour au check-in">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Historique des check-ins</h1>
          <p className="text-sm text-muted-foreground">{(event?.title as string) ?? ""}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
      <div className="bg-card rounded-lg border overflow-hidden">
        <DataTable<Record<string, unknown>>
          aria-label="Historique des check-ins"
          emptyMessage="Aucun check-in trouve"
          responsiveCards
          loading={isLoading}
          data={entries}
          columns={
            [
              {
                key: "participant",
                header: "Participant",
                primary: true,
                render: (entry) => (
                  <div>
                    <div className="font-medium text-foreground">
                      {(entry.participantName as string) ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(entry.participantEmail as string) ?? ""}
                    </div>
                  </div>
                ),
              },
              {
                key: "ticketTypeName",
                header: "Billet",
                render: (entry) => (entry.ticketTypeName as string) ?? "—",
              },
              {
                key: "accessZoneName",
                header: "Zone",
                render: (entry) =>
                  entry.accessZoneName ? (
                    <Badge variant="info">{entry.accessZoneName as string}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: "checkedInAt",
                header: "Heure",
                render: (entry) => (
                  <span className="text-muted-foreground">
                    {new Date(entry.checkedInAt as string).toLocaleString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                ),
              },
              {
                key: "staffName",
                header: "Staff",
                hideOnMobile: true,
                render: (entry) => (
                  <span className="text-muted-foreground">
                    {(entry.staffName as string) ?? "—"}
                  </span>
                ),
              },
            ] as DataTableColumn<Record<string, unknown>>[]
          }
        />

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted">
            <span className="text-sm text-muted-foreground">
              Page {meta.page} / {meta.totalPages} ({meta.total} resultats)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded hover:bg-accent disabled:opacity-30"
                aria-label="Page précédente"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= meta.totalPages}
                className="p-1 rounded hover:bg-accent disabled:opacity-30"
                aria-label="Page suivante"
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
