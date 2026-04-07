"use client";

import Link from "next/link";
import { useEvents } from "@/hooks/use-events";
import { formatDate } from "@/lib/utils";
import { Calendar, Users, Ticket, TrendingUp, ArrowRight, Loader2 } from "lucide-react";

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: "Brouillon", className: "bg-muted text-muted-foreground" },
  published: { label: "Publié", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Annulé", className: "bg-red-100 text-red-700" },
};

export default function DashboardPage() {
  const { data, isLoading } = useEvents({ limit: 5, orderBy: "createdAt", orderDir: "desc" });

  const events = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const publishedCount = events.filter((e) => e.status === "published").length;
  const totalRegistered = events.reduce((sum, e) => sum + (e.registeredCount ?? 0), 0);
  const totalCheckedIn = events.reduce((sum, e) => sum + (e.checkedInCount ?? 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-6">Tableau de bord</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Calendar className="h-5 w-5 text-blue-600" />}
          label="Total événements"
          value={isLoading ? "..." : String(total)}
          bgColor="bg-blue-50"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-green-600" />}
          label="Publiés"
          value={isLoading ? "..." : String(publishedCount)}
          bgColor="bg-green-50"
        />
        <StatCard
          icon={<Users className="h-5 w-5 text-purple-600" />}
          label="Inscrits récents"
          value={isLoading ? "..." : String(totalRegistered)}
          bgColor="bg-purple-50"
        />
        <StatCard
          icon={<Ticket className="h-5 w-5 text-orange-600" />}
          label="Check-ins"
          value={isLoading ? "..." : String(totalCheckedIn)}
          bgColor="bg-orange-50"
        />
      </div>

      {/* Recent events */}
      <div className="bg-card rounded-xl border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Événements récents</h2>
          <Link href="/events" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
            Tout voir <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Aucun événement. <Link href="/events/new" className="text-primary hover:underline">Créer votre premier</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {events.map((event) => {
                const status = STATUS_LABELS[event.status] ?? STATUS_LABELS.draft;
                return (
                  <tr key={event.id} className="border-b border-border last:border-0 hover:bg-accent transition-colors">
                    <td className="px-6 py-3.5">
                      <Link href={`/events/${event.id}`} className="font-medium text-foreground hover:text-primary">
                        {event.title}
                      </Link>
                    </td>
                    <td className="px-6 py-3.5 text-muted-foreground text-xs whitespace-nowrap">
                      {formatDate(event.startDate)}
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right text-muted-foreground">
                      {event.registeredCount ?? 0} inscrits
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bgColor: string;
}) {
  return (
    <div className="bg-card rounded-xl p-5 shadow-sm border border-border">
      <div className="flex items-center gap-3 mb-3">
        <div className={`${bgColor} p-2 rounded-lg`}>{icon}</div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      <p className="text-3xl font-bold text-primary">{value}</p>
    </div>
  );
}
