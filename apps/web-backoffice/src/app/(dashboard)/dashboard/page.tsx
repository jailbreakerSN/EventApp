"use client";

import Link from "next/link";
import { useEvents } from "@/hooks/use-events";
import { useOrgAnalytics } from "@/hooks/use-organization";
import { formatDate } from "@/lib/utils";
import { getEventStatusLabel } from "@/lib/event-status";
import { Calendar, Users, Ticket, TrendingUp, ArrowRight, Banknote } from "lucide-react";
import {
  Skeleton,
  Badge,
  getStatusVariant,
  DataTable,
  type DataTableColumn,
} from "@teranga/shared-ui";

export default function DashboardPage() {
  // Recent-events list for the bottom of the page — kept at 5 for a
  // focused "last activity" panel.
  const { data, isLoading } = useEvents({ limit: 5, orderBy: "createdAt", orderDir: "desc" });
  const events = data?.data ?? [];

  // Stat cards read from the org-analytics endpoint (timeframe=all)
  // so the numbers aggregate across EVERY event, not just the 5 most
  // recent. Previously the dashboard reduced over the 5-event page and
  // silently underreported totals for any org with more than five
  // events — the fix surfaces real org-wide figures.
  const { data: analyticsData, isLoading: analyticsLoading } = useOrgAnalytics({
    timeframe: "all",
  });
  const summary = analyticsData?.data?.summary;
  const total = summary?.totalEvents ?? 0;
  const totalRegistered = summary?.totalRegistrations ?? 0;
  const totalCheckedIn = summary?.totalCheckedIn ?? 0;
  // Published count is cheap to derive from the recent events page; an
  // exact org-wide `publishedCount` would require extending the
  // analytics summary, which we defer until someone actually asks.
  const publishedCount = events.filter((e) => e.status === "published").length;

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
          value={analyticsLoading ? undefined : String(total)}
          bgColor="bg-blue-50 dark:bg-blue-900/20"
          isLoading={analyticsLoading}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-green-600" />}
          label="Publiés (récents)"
          value={isLoading ? undefined : String(publishedCount)}
          bgColor="bg-green-50 dark:bg-green-900/20"
          isLoading={isLoading}
          subtitle="Sur les 5 derniers"
        />
        <StatCard
          icon={<Users className="h-5 w-5 text-purple-600" />}
          label="Total inscrits"
          value={analyticsLoading ? undefined : String(totalRegistered)}
          bgColor="bg-purple-50 dark:bg-purple-900/20"
          isLoading={analyticsLoading}
          subtitle="Tous événements confondus"
        />
        <StatCard
          icon={<Ticket className="h-5 w-5 text-orange-600" />}
          label="Check-ins"
          value={analyticsLoading ? undefined : String(totalCheckedIn)}
          bgColor="bg-orange-50 dark:bg-orange-900/20"
          isLoading={analyticsLoading}
          subtitle="Tous événements confondus"
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

        <DataTable<(typeof events)[number] & Record<string, unknown>>
          aria-label="Événements récents"
          emptyMessage="Aucun événement pour le moment."
          responsiveCards
          loading={isLoading}
          data={events as ((typeof events)[number] & Record<string, unknown>)[]}
          columns={
            [
              {
                key: "title",
                header: "Événement",
                primary: true,
                render: (event) => (
                  <Link
                    href={`/events/${event.id}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {event.title}
                  </Link>
                ),
              },
              {
                key: "startDate",
                header: "Date",
                hideOnMobile: true,
                render: (event) => (
                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                    {formatDate(event.startDate)}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Statut",
                render: (event) => (
                  <Badge variant={getStatusVariant(event.status)}>
                    {getEventStatusLabel(event.status)}
                  </Badge>
                ),
              },
              {
                key: "registered",
                header: "Inscrits",
                render: (event) => (
                  <span className="text-muted-foreground">
                    {event.registeredCount ?? 0} inscrits
                  </span>
                ),
              },
            ] as DataTableColumn<(typeof events)[number] & Record<string, unknown>>[]
          }
        />
        {events.length === 0 && !isLoading && (
          <div className="p-8 text-center text-muted-foreground">
            <Link href="/events/new" className="text-primary hover:underline">
              Créer votre premier événement
            </Link>
          </div>
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
  deltaPct,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  bgColor: string;
  isLoading?: boolean;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  /** Optional numeric delta — rendered as "+X %" / "−X %" when provided. */
  deltaPct?: number;
  subtitle?: string;
}) {
  // ui-ux-pro-max rule 78: never rely on color alone.
  // Each delta uses glyph (triangle) + textual sign + semantic color.
  // Positive = teranga-green, negative = teranga-gold-dark (avoids
  // red/green confusion for deuteranopia; both hit 4.5:1 on bg-card in
  // both light and dark themes).
  const trendDisplay = trend
    ? {
        up: {
          glyph: "\u25B2", // ▲
          className: "text-teranga-green",
          ariaDirection: "Hausse",
        },
        down: {
          glyph: "\u25BC", // ▼
          className: "text-teranga-gold-dark",
          ariaDirection: "Baisse",
        },
        neutral: {
          glyph: "\u2014", // —
          className: "text-muted-foreground",
          ariaDirection: "Stable",
        },
      }[trend]
    : null;

  const signedDelta =
    typeof deltaPct === "number"
      ? `${deltaPct > 0 ? "+" : deltaPct < 0 ? "\u2212" : ""}${Math.abs(deltaPct)}\u00A0%`
      : null;

  const ariaLabel =
    trendDisplay && trendLabel
      ? typeof deltaPct === "number"
        ? `${trendDisplay.ariaDirection} de ${Math.abs(deltaPct)} pour cent ${trendLabel}`
        : `${trendDisplay.ariaDirection} ${trendLabel}`
      : undefined;

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
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${trendDisplay.className}`}
                aria-label={ariaLabel}
              >
                <span aria-hidden="true">{trendDisplay.glyph}</span>
                {signedDelta && <span aria-hidden="true">{signedDelta}</span>}
                {trendLabel && <span aria-hidden="true">{trendLabel}</span>}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </>
      )}
    </div>
  );
}
