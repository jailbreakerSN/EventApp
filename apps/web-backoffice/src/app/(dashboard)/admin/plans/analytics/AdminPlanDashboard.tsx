"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  QueryError,
  Spinner,
} from "@teranga/shared-ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import {
  AlertTriangle,
  CalendarClock,
  CreditCard,
  Layers,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAdminPlanAnalytics } from "@/hooks/use-admin";
import type { PlanAnalytics } from "@teranga/shared-types";

// Phase 7+ item #5 — MRR / cohort dashboard.
//
// Point-in-time snapshot, not a historical time-series. The operator's
// question is "what's the state of the world RIGHT NOW?" — MRR, tier
// mix, who's about to convert from trial, who's about to hit a limit.
// Week-over-week deltas require a snapshotting job; deferred.

function formatXof(amount: number): string {
  return new Intl.NumberFormat("fr-SN", {
    style: "currency",
    currency: "XOF",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Palette — hand-picked from Teranga tokens to guarantee WCAG AA contrast
// on both light and dark themes. Do NOT replace with recharts defaults
// (those fail contrast).
const TIER_COLORS: Record<string, string> = {
  free: "hsl(var(--muted-foreground))",
  starter: "hsl(var(--primary))",
  pro: "hsl(var(--teranga-gold))",
  enterprise: "hsl(var(--teranga-green))",
};

function tierColor(tier: string): string {
  return TIER_COLORS[tier] ?? "hsl(var(--muted-foreground))";
}

export function AdminPlanDashboard() {
  const { data, isLoading, isError, error, refetch } = useAdminPlanAnalytics();

  return (
    <div className="space-y-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin/plans">Plans</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Analytique</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-3">
        <TrendingUp className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytique des plans</h1>
          <p className="text-sm text-muted-foreground">
            MRR, répartition par offre, organisations proches des limites et essais en cours.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
          <Spinner />
        </div>
      )}

      {isError && (
        <QueryError
          title="Impossible de charger les analytiques"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data?.data && <AnalyticsBody analytics={data.data} />}
    </div>
  );
}

function AnalyticsBody({ analytics }: { analytics: PlanAnalytics }) {
  const tierMixEntries = Object.entries(analytics.tierMix);
  const totalActiveSubs = tierMixEntries.reduce((sum, [, v]) => sum + v.count, 0);
  const hasAnySub = totalActiveSubs > 0;

  return (
    <>
      <p
        className="text-xs text-muted-foreground"
        aria-label={`Dernière mise à jour à ${formatDateTime(analytics.computedAt)}`}
      >
        Dernière mise à jour : {formatDateTime(analytics.computedAt)}
      </p>

      {/* Top cards — MRR, pipeline, bookings, overrides */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<CreditCard className="h-5 w-5 text-primary" />}
          label="MRR — Revenu mensuel récurrent"
          value={formatXof(analytics.mrr.total)}
          hint={`Annuels normalisés : prix / 12`}
        />
        <StatCard
          icon={<Sparkles className="h-5 w-5 text-teranga-gold" />}
          label="MRR de pipeline (essais)"
          value={formatXof(analytics.trialingMRR.total)}
          hint={`Si tous les essais convertissent`}
        />
        <StatCard
          icon={<Layers className="h-5 w-5 text-primary" />}
          label="Encaissements bruts"
          value={formatXof(analytics.bookings.total)}
          hint={`Annuels comptabilisés en entier`}
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5 text-muted-foreground" />}
          label="Plans personnalisés"
          value={analytics.overrideCount.toLocaleString("fr-FR")}
          hint={`Overrides actifs`}
        />
      </div>

      {/* Charts + lists row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Tier mix */}
        <Card>
          <CardHeader>
            <CardTitle>Répartition par offre</CardTitle>
          </CardHeader>
          <CardContent>
            {hasAnySub ? (
              <div className="space-y-3">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={tierMixEntries.map(([tier, v]) => ({
                        name: tier,
                        value: v.count,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      label={(entry: { name: string; value: number }) =>
                        `${entry.name} (${entry.value})`
                      }
                    >
                      {tierMixEntries.map(([tier]) => (
                        <Cell key={tier} fill={tierColor(tier)} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        `${value} org${value > 1 ? "s" : ""}`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Version-split text below the chart (the payoff of Phase
                    7 versioning — see what's on v1 vs v2, helps retire
                    historical versions). */}
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {tierMixEntries.map(([tier, v]) => (
                    <li key={tier}>
                      <span className="font-medium text-foreground">{tier}</span> · {v.count} org
                      {v.count > 1 ? "s" : ""}
                      {Object.keys(v.byVersion).length > 1 && (
                        <>
                          {" "}
                          (
                          {Object.entries(v.byVersion)
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([ver, c]) => `v${ver}: ${c}`)
                            .join(", ")}
                          )
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Aucun abonnement actif.
              </p>
            )}
          </CardContent>
        </Card>

        {/* MRR by tier bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>MRR par offre</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.mrr.total > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={Object.entries(analytics.mrr.byTier).map(([tier, amount]) => ({
                    tier,
                    amount,
                  }))}
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="tier" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                  />
                  <Tooltip formatter={(v: number) => formatXof(v)} />
                  <Bar dataKey="amount">
                    {Object.keys(analytics.mrr.byTier).map((tier) => (
                      <Cell key={tier} fill={tierColor(tier)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Aucun revenu récurrent pour le moment.
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Mensuel : {analytics.annualVsMonthly.monthly} abonnement
              {analytics.annualVsMonthly.monthly > 1 ? "s" : ""} · Annuel :{" "}
              {analytics.annualVsMonthly.annual} abonnement
              {analytics.annualVsMonthly.annual > 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Trials ending + near-limit lists */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-teranga-gold" />
              Essais se terminant cette semaine
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.trialsEndingSoon.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aucun essai ne se termine dans les 7 prochains jours.
              </p>
            ) : (
              <ul className="space-y-2">
                {analytics.trialsEndingSoon.map((t) => (
                  <li
                    key={t.orgId}
                    className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium text-foreground">{t.orgName}</p>
                      <p className="text-xs text-muted-foreground">
                        Essai <Badge variant="premium">{t.tier}</Badge>
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Fin le {formatDate(t.trialEndAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Organisations proches des limites
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.nearLimitOrgs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aucune organisation à plus de 80 % de ses limites.
              </p>
            ) : (
              <ul className="space-y-2">
                {analytics.nearLimitOrgs.slice(0, 10).map((n, i) => (
                  <li
                    key={`${n.orgId}-${n.resource}-${i}`}
                    className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium text-foreground">{n.orgName}</p>
                      <p className="text-xs text-muted-foreground">
                        <Badge variant="neutral">{n.tier}</Badge> ·{" "}
                        {n.resource === "events" ? "Événements" : "Membres"} : {n.current}/{n.limit}
                      </p>
                    </div>
                    <Badge variant={n.pct >= 95 ? "destructive" : "warning"}>{n.pct}%</Badge>
                  </li>
                ))}
                {analytics.nearLimitOrgs.length > 10 && (
                  <li className="text-center text-xs italic text-muted-foreground">
                    … et {analytics.nearLimitOrgs.length - 10} autre
                    {analytics.nearLimitOrgs.length - 10 > 1 ? "s" : ""}.
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
