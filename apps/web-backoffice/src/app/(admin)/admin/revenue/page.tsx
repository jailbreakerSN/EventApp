"use client";

/**
 * Phase F (P7 closure) — Revenue dashboard.
 *
 * Reads /v1/admin/revenue which sums active-subscription priceXof
 * (annual subs normalised to monthly). Displays headline MRR / ARR
 * cards + per-plan breakdown table. No charts library pulled in — the
 * breakdown is small enough that a tabular view is clearer than
 * a bar chart at this scale.
 *
 * A.3 closure adds a signup-cohort retention section (last 12 months
 * by default) showing what fraction of each cohort still holds an
 * active subscription. Read from /v1/admin/revenue/cohorts.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  SectionHeader,
  Skeleton,
} from "@teranga/shared-ui";
import { Coins, TrendingUp, Users, LineChart } from "lucide-react";
import { api } from "@/lib/api-client";
import { useErrorHandler } from "@/hooks/use-error-handler";

interface RevenueSnapshot {
  mrrXof: number;
  arrXof: number;
  activeSubscriptions: number;
  byPlan: Record<string, { count: number; mrrXof: number }>;
  computedAt: string;
}

interface CohortsSnapshot {
  cohorts: Array<{
    cohortMonth: string;
    signupCount: number;
    retainedNow: number;
    retentionPct: number;
  }>;
  computedAt: string;
}

function fmtXof(v: number): string {
  try {
    return new Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" }).format(v);
  } catch {
    return `${v} XOF`;
  }
}

export default function AdminRevenuePage() {
  const { resolve } = useErrorHandler();
  const [data, setData] = useState<RevenueSnapshot | null>(null);
  const [cohorts, setCohorts] = useState<CohortsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      // Two parallel fetches — the snapshot and the retention curve
      // are independent so we don't gate the headline cards on the
      // cohorts read.
      const [snapshotRes, cohortsRes] = await Promise.all([
        api.get<{ success: boolean; data: RevenueSnapshot }>("/v1/admin/revenue"),
        api.get<{ success: boolean; data: CohortsSnapshot }>(
          "/v1/admin/revenue/cohorts?months=12",
        ),
      ]);
      setData(snapshotRes.data);
      setCohorts(cohortsRes.data);
      setError(null);
    } catch (err) {
      setError(resolve(err).description);
    }
  }, [resolve]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Revenus</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Billing"
        title="Revenus"
        subtitle="Instantané des revenus récurrents — MRR, ARR, répartition par plan."
      />

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-red-600">{error}</CardContent>
        </Card>
      )}

      {!data && !error && (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="text" className="h-24 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              icon={<Coins className="h-5 w-5 text-teranga-gold" aria-hidden="true" />}
              label="MRR — Monthly recurring"
              value={fmtXof(data.mrrXof)}
            />
            <MetricCard
              icon={<TrendingUp className="h-5 w-5 text-teranga-green" aria-hidden="true" />}
              label="ARR — Annual recurring (×12)"
              value={fmtXof(data.arrXof)}
            />
            <MetricCard
              icon={<Users className="h-5 w-5 text-teranga-navy" aria-hidden="true" />}
              label="Abonnements actifs"
              value={String(data.activeSubscriptions)}
            />
          </div>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Plan</th>
                    <th className="px-4 py-2 text-right">Abonnements</th>
                    <th className="px-4 py-2 text-right">MRR</th>
                    <th className="px-4 py-2 text-right">ARR projeté</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.byPlan)
                    .sort(([, a], [, b]) => b.mrrXof - a.mrrXof)
                    .map(([plan, stats]) => (
                      <tr key={plan} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 font-medium">{plan}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{stats.count}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">
                          {fmtXof(stats.mrrXof)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs">
                          {fmtXof(stats.mrrXof * 12)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="text-right text-[10px] text-muted-foreground">
            Instantané calculé le {new Date(data.computedAt).toLocaleString("fr-FR")}
          </div>

          {/* A.3 closure — cohort retention curve */}
          <SectionHeader
            kicker="— Rétention"
            title="Rétention par cohorte de signup"
            subtitle="Pour chaque mois d'inscription des 12 derniers mois, % d'organisations encore en abonnement actif aujourd'hui."
          />

          {cohorts && <CohortsSection cohorts={cohorts} />}
          {!cohorts && (
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} variant="text" className="h-24 w-full" />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CohortsSection({ cohorts }: { cohorts: CohortsSnapshot }) {
  // Aggregate stats across the visible cohorts. We compute the
  // weighted average retention (weighted by cohort size) rather than
  // the unweighted mean — a single small cohort with 0% retention
  // shouldn't drag down the platform-wide signal.
  const totalSignups = cohorts.cohorts.reduce((acc, c) => acc + c.signupCount, 0);
  const totalRetained = cohorts.cohorts.reduce((acc, c) => acc + c.retainedNow, 0);
  const weightedRetention = totalSignups > 0 ? totalRetained / totalSignups : 0;

  // Tail-weighted retention — the recent month always retains 100%
  // (signed up days ago, still active) so it skews the lifetime
  // signal. Compute the average over all cohorts older than 1 month
  // for a more honest "long-tail" signal.
  const matureCohorts = cohorts.cohorts.slice(0, -1);
  const matureSignups = matureCohorts.reduce((acc, c) => acc + c.signupCount, 0);
  const matureRetained = matureCohorts.reduce((acc, c) => acc + c.retainedNow, 0);
  const matureRetention = matureSignups > 0 ? matureRetained / matureSignups : 0;

  if (totalSignups === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
          <LineChart className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm font-semibold text-foreground">
            Pas encore assez de données
          </div>
          <div className="max-w-sm text-xs text-muted-foreground">
            Aucune organisation n&apos;a été créée sur la fenêtre de 12 mois. La courbe de
            rétention apparaîtra dès les premiers signups.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={<Users className="h-5 w-5 text-teranga-navy" aria-hidden="true" />}
          label="Signups (12 derniers mois)"
          value={String(totalSignups)}
        />
        <MetricCard
          icon={<TrendingUp className="h-5 w-5 text-teranga-green" aria-hidden="true" />}
          label="Rétention moyenne pondérée"
          value={`${Math.round(weightedRetention * 100)}%`}
        />
        <MetricCard
          icon={<LineChart className="h-5 w-5 text-teranga-gold" aria-hidden="true" />}
          label="Rétention hors mois courant"
          value={
            matureCohorts.length > 0 ? `${Math.round(matureRetention * 100)}%` : "—"
          }
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Cohorte</th>
                <th className="px-4 py-2 text-right">Signups</th>
                <th className="px-4 py-2 text-right">Encore actifs</th>
                <th className="px-4 py-2 text-right">Rétention</th>
                <th className="px-4 py-2">Courbe</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.cohorts.map((c) => (
                <tr key={c.cohortMonth} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-foreground">
                    {c.cohortMonth}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {c.signupCount}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {c.retainedNow}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {c.signupCount > 0 ? `${Math.round(c.retentionPct * 100)}%` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {c.signupCount > 0 ? (
                      <RetentionBar pct={c.retentionPct} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="text-right text-[10px] text-muted-foreground">
        Calcul basé sur l&apos;état actuel des abonnements ({" "}
        {new Date(cohorts.computedAt).toLocaleString("fr-FR")} ). Le mois courant
        retient mécaniquement 100% — utilisez la moyenne « hors mois courant » comme
        signal long-terme.
      </div>
    </>
  );
}

function RetentionBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(1, pct));
  // Color scale: < 30% red, 30-60% amber, > 60% green. Crude but
  // gives the eye a quick read on cohort health without forcing the
  // operator to read every percentage.
  const color =
    clamped < 0.3
      ? "bg-red-500"
      : clamped < 0.6
        ? "bg-amber-500"
        : "bg-teranga-green";
  return (
    <div className="flex items-center gap-2" aria-label={`Rétention ${Math.round(clamped * 100)}%`}>
      <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${color}`}
          style={{ width: `${clamped * 100}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>
        <div className="text-2xl font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}
