"use client";

/**
 * Phase F (P7 closure) — Revenue dashboard.
 *
 * Reads /v1/admin/revenue which sums active-subscription priceXof
 * (annual subs normalised to monthly). Displays headline MRR / ARR
 * cards + per-plan breakdown table. No charts library pulled in — the
 * breakdown is small enough that a tabular view is clearer than
 * a bar chart at this scale.
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
import { Coins, TrendingUp, Users } from "lucide-react";
import { api } from "@/lib/api-client";
import { useErrorHandler } from "@/hooks/use-error-handler";

interface RevenueSnapshot {
  mrrXof: number;
  arrXof: number;
  activeSubscriptions: number;
  byPlan: Record<string, { count: number; mrrXof: number }>;
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
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: RevenueSnapshot }>("/v1/admin/revenue");
      setData(res.data);
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
        </>
      )}
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
