"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEvent } from "@/hooks/use-events";
import { useCheckinStats, useCheckinHistory } from "@/hooks/use-checkin";
import {
  ArrowLeft,
  Users,
  UserCheck,
  Clock,
  MapPin,
  Loader2,
  History,
  RefreshCw,
} from "lucide-react";

export default function CheckinDashboardPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();

  const { data: eventData, isLoading: eventLoading } = useEvent(eventId);
  const { data: statsData, isLoading: statsLoading, dataUpdatedAt } = useCheckinStats(eventId);
  const { data: recentData } = useCheckinHistory(eventId, { limit: 10, page: 1 });

  const event = (eventData as { data?: Record<string, unknown> })?.data as Record<string, unknown> | undefined;
  const stats = (statsData as { data?: Record<string, unknown> })?.data as Record<string, unknown> | undefined;
  const recentEntries = (recentData as { data?: Array<Record<string, unknown>> })?.data ?? [];

  if (eventLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Evenement introuvable</p>
      </div>
    );
  }

  const totalRegistered = (stats?.totalRegistered as number) ?? 0;
  const totalCheckedIn = (stats?.totalCheckedIn as number) ?? 0;
  const totalPending = (stats?.totalPending as number) ?? 0;
  const percentage = totalRegistered > 0 ? Math.round((totalCheckedIn / totalRegistered) * 100) : 0;
  const lastCheckinAt = stats?.lastCheckinAt as string | null;
  const byZone = (stats?.byZone as Array<{ zoneId: string; zoneName: string; checkedIn: number; capacity: number | null }>) ?? [];
  const byTicketType = (stats?.byTicketType as Array<{ ticketTypeId: string; ticketTypeName: string; registered: number; checkedIn: number }>) ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(`/events/${eventId}`)} className="p-2 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Check-in en direct</h1>
            <p className="text-sm text-gray-500">{event.title as string}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <RefreshCw className="h-3 w-3" />
          Actualisation auto toutes les 10s
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Users className="h-5 w-5 text-blue-600" />}
          label="Inscrits"
          value={String(totalRegistered)}
          bgColor="bg-blue-50"
        />
        <StatCard
          icon={<UserCheck className="h-5 w-5 text-green-600" />}
          label="Entrees"
          value={`${totalCheckedIn} (${percentage}%)`}
          bgColor="bg-green-50"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-yellow-600" />}
          label="En attente"
          value={String(totalPending)}
          bgColor="bg-yellow-50"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-purple-600" />}
          label="Dernier check-in"
          value={lastCheckinAt ? formatTime(lastCheckinAt) : "—"}
          bgColor="bg-purple-50"
        />
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Progression globale</span>
          <span className="text-sm font-bold text-gray-900">{percentage}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div
            className="bg-green-500 h-4 rounded-full transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">{totalCheckedIn} / {totalRegistered} participants</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Zone capacity */}
        {byZone.length > 0 && (
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MapPin className="h-5 w-5" /> Zones d'acces
            </h2>
            <div className="space-y-4">
              {byZone.map((zone) => {
                const zonePercent = zone.capacity ? Math.round((zone.checkedIn / zone.capacity) * 100) : null;
                return (
                  <div key={zone.zoneId}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700">{zone.zoneName}</span>
                      <span className="text-sm text-gray-500">
                        {zone.checkedIn}{zone.capacity ? ` / ${zone.capacity}` : ""}
                      </span>
                    </div>
                    {zone.capacity && (
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${zonePercent! >= 90 ? "bg-red-500" : zonePercent! >= 70 ? "bg-yellow-500" : "bg-blue-500"}`}
                          style={{ width: `${Math.min(zonePercent!, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* By ticket type */}
        {byTicketType.length > 0 && (
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Par type de billet</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Type</th>
                  <th className="pb-2 text-right">Inscrits</th>
                  <th className="pb-2 text-right">Entrees</th>
                  <th className="pb-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {byTicketType.map((tt) => {
                  const pct = tt.registered > 0 ? Math.round((tt.checkedIn / tt.registered) * 100) : 0;
                  return (
                    <tr key={tt.ticketTypeId} className="border-b last:border-0">
                      <td className="py-2 font-medium">{tt.ticketTypeName}</td>
                      <td className="py-2 text-right">{tt.registered}</td>
                      <td className="py-2 text-right">{tt.checkedIn}</td>
                      <td className="py-2 text-right">{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent check-ins feed */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <History className="h-5 w-5" /> Check-ins recents
          </h2>
          <Link
            href={`/events/${eventId}/checkin/history`}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Voir tout
          </Link>
        </div>

        {recentEntries.length === 0 ? (
          <p className="text-gray-400 text-center py-8">Aucun check-in pour le moment</p>
        ) : (
          <div className="space-y-2">
            {recentEntries.map((entry, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <span className="font-medium text-gray-900">
                    {(entry.participantName as string) ?? (entry.participantEmail as string) ?? "Inconnu"}
                  </span>
                  <span className="text-gray-400 mx-2">-</span>
                  <span className="text-sm text-gray-500">{entry.ticketTypeName as string}</span>
                  {entry.accessZoneName && (
                    <span className="ml-2 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                      {entry.accessZoneName as string}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">{formatTime(entry.checkedInAt as string)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, bgColor }: { icon: React.ReactNode; label: string; value: string; bgColor: string }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <div className={`${bgColor} p-2 rounded-lg`}>{icon}</div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
