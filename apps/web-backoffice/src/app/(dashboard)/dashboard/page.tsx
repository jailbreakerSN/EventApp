"use client";

import Link from "next/link";
import { useEvents } from "@/hooks/use-events";
import { formatDate } from "@/lib/utils";
import { Calendar, Users, Ticket, TrendingUp, ArrowRight, Banknote } from "lucide-react";
import { Skeleton, Badge, getStatusVariant } from "@teranga/shared-ui";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  published: "Publié",
  cancelled: "Annulé",
};

export default function DashboardPage() {
  const { data, isLoading } = useEvents({ limit: 5, orderBy: "createdAt", orderDir: "desc" });

  const events = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const publishedCount = events.filter((e) => e.status === "published").length;
  const totalRegistered = events.reduce((sum, e) => sum + (e.registeredCount ?? 0), 0);
  const totalCheckedIn = events.reduce((sum, e) => sum + (e.checkedInCount ?? 0), 0);

  const formatXOF = (amount: number) =>
    new Intl.NumberFormat("fr-SN", {
      style: "currency",
      currency: "XOF",
      minimumFractionDigits: 0,
    }).format(amount);

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-6">Tableau de bord</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <StatCard
          icon={<Calendar className="h-5 w-5 text-blue-600" />}
          label="Total événements"
          value={isLoading ? undefined : String(total)}
          bgColor="bg-blue-50 dark:bg-blue-900/20"
          isLoading={isLoading}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-green-600" />}
          label="Publiés"
          value={isLoading ? undefined : String(publishedCount)}
          bgColor="bg-green-50 dark:bg-green-900/20"
          isLoading={isLoading}
        />
        <StatCard
          icon={<Users className="h-5 w-5 text-purple-600" />}
          label="Inscrits récents"
          value={isLoading ? undefined : String(totalRegistered)}
          bgColor="bg-purple-50 dark:bg-purple-900/20"
          isLoading={isLoading}
          trend="up"
          trendLabel="vs dernier mois"
        />
        <StatCard
          icon={<Ticket className="h-5 w-5 text-orange-600" />}
          label="Check-ins"
          value={isLoading ? undefined : String(totalCheckedIn)}
          bgColor="bg-orange-50 dark:bg-orange-900/20"
          isLoading={isLoading}
          trend="up"
          trendLabel="vs dernier mois"
        />
        <StatCard
          icon={<Banknote className="h-5 w-5 text-amber-600" />}
          label="Revenus"
          value={isLoading ? undefined : formatXOF(0)}
          bgColor="bg-amber-50 dark:bg-amber-900/20"
          isLoading={isLoading}
          subtitle="Paiements bientôt disponibles"
        />
      </div>

      {/* Recent events */}
      <div className="bg-card rounded-xl border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Événements récents</h2>
          <Link
            href="/events"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            Tout voir <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {isLoading ? (
          <table className="w-full text-sm">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-6 py-3.5">
                    <Skeleton variant="text" className="h-4 w-36" />
                  </td>
                  <td className="px-6 py-3.5">
                    <Skeleton variant="text" className="h-4 w-20" />
                  </td>
                  <td className="px-6 py-3.5">
                    <Skeleton variant="text" className="h-5 w-16 rounded-full" />
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <Skeleton variant="text" className="h-4 w-16 ml-auto" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Aucun événement.{" "}
            <Link href="/events/new" className="text-primary hover:underline">
              Créer votre premier
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {events.map((event) => {
                const statusLabel = STATUS_LABELS[event.status] ?? STATUS_LABELS.draft;
                return (
                  <tr
                    key={event.id}
                    className="border-b border-border last:border-0 hover:bg-accent transition-colors"
                  >
                    <td className="px-6 py-3.5">
                      <Link
                        href={`/events/${event.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {event.title}
                      </Link>
                    </td>
                    <td className="px-6 py-3.5 text-muted-foreground text-xs whitespace-nowrap">
                      {formatDate(event.startDate)}
                    </td>
                    <td className="px-6 py-3.5">
                      <Badge variant={getStatusVariant(event.status)}>{statusLabel}</Badge>
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
  isLoading,
  trend,
  trendLabel,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  bgColor: string;
  isLoading?: boolean;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  subtitle?: string;
}) {
  const trendDisplay = trend
    ? {
        up: { arrow: "\u2191", className: "text-emerald-600" },
        down: { arrow: "\u2193", className: "text-red-500" },
        neutral: { arrow: "\u2192", className: "text-muted-foreground" },
      }[trend]
    : null;

  return (
    <div className="bg-card rounded-xl p-5 shadow-sm border border-border">
      <div className="flex items-center gap-3 mb-3">
        <div className={`${bgColor} p-2 rounded-lg`}>{icon}</div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      {isLoading ? (
        <Skeleton variant="text" className="h-8 w-16" />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold text-primary">{value}</p>
            {trendDisplay && (
              <span className={`text-xs font-medium ${trendDisplay.className}`}>
                {trendDisplay.arrow} {trendLabel}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </>
      )}
    </div>
  );
}
