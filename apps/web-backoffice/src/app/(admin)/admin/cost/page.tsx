"use client";

/**
 * Sprint-3 T4.2 closure — Firestore read-volume cost dashboard.
 *
 * Surfaces:
 *  - Daily volume across the platform (sparkline, last 7 days)
 *  - Top-N noisy organisations (bar chart + table)
 *  - Per-org drill-down (link to `/admin/organizations/[id]?tab=cost`
 *    — currently lands on the org detail; the org-tab page is a
 *    follow-up).
 *
 * Permission: read-only admin gate. Uses the existing
 * `readOnlyAdminPreHandler` (`platform:audit_read OR
 * platform:manage`) on the underlying endpoint.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  Select,
  InlineErrorBanner,
} from "@teranga/shared-ui";
import { Activity, TrendingUp, Building2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useErrorHandler } from "@/hooks/use-error-handler";

interface UsageSnapshot {
  days: number;
  fromDay: string;
  toDay: string;
  totalReads: number;
  topConsumers: Array<{ organizationId: string; reads: number; pct: number }>;
  daily: Array<{ day: string; reads: number }>;
}

const WINDOW_OPTIONS = [
  { value: 1, label: "Aujourd'hui" },
  { value: 7, label: "7 derniers jours" },
  { value: 14, label: "14 derniers jours" },
  { value: 30, label: "30 derniers jours" },
];

function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR");
}

export default function AdminCostPage() {
  const { resolve } = useErrorHandler();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: UsageSnapshot }>(
        `/v1/admin/usage/firestore?days=${days}&topN=10`,
      );
      setData(res.data);
      setError(null);
    } catch (err) {
      setError(resolve(err).description);
    }
  }, [days, resolve]);

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
            <BreadcrumbPage>Coût Firestore</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Platform"
        title="Volume de lectures Firestore"
        subtitle="Suivi des lectures par organisation. Permet d'identifier les orgs qui consomment plus que prévu avant que la facture GCP ne grimpe. Données mises à jour à chaque réponse HTTP — la latence d'affichage est de l'ordre de la seconde."
        action={
          <div className="w-56">
            <Select
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Fenêtre de temps"
            >
              {WINDOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {error && (
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Impossible de charger les statistiques d'usage"
          description={error}
          actions={[{ label: "Réessayer", onClick: () => void fetchData() }]}
        />
      )}

      {!data && !error && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton variant="text" className="h-24 w-full" />
          <Skeleton variant="text" className="h-24 w-full" />
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="space-y-1 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Total des lectures
                  </span>
                  <Activity className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
                </div>
                <div className="text-2xl font-semibold text-foreground">
                  {formatNumber(data.totalReads)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Du {data.fromDay} au {data.toDay}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Moyenne quotidienne
                  </span>
                  <TrendingUp className="h-5 w-5 text-teranga-green" aria-hidden="true" />
                </div>
                <div className="text-2xl font-semibold text-foreground">
                  {formatNumber(Math.round(data.totalReads / Math.max(1, data.days)))}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  lectures / jour sur la fenêtre
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="text-sm font-semibold text-foreground">
                Volume quotidien
              </div>
              <DailyBars daily={data.daily} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  Top des organisations consommatrices
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {data.topConsumers.length} sur {data.topConsumers.length} affichées
                </span>
              </div>
              {data.topConsumers.length === 0 ? (
                <div className="rounded-md border border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                  Aucune donnée d&apos;usage sur la fenêtre. Les compteurs sont écrits à
                  chaque réponse HTTP — la première lecture publique ou admin
                  apparaîtra ici dans la seconde qui suit.
                </div>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border">
                  {data.topConsumers.map((c, idx) => (
                    <Link
                      key={c.organizationId}
                      href={`/admin/organizations/${encodeURIComponent(c.organizationId)}`}
                      className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teranga-gold/10 text-[11px] font-semibold text-teranga-gold">
                          {idx + 1}
                        </span>
                        <Building2
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <code className="truncate font-mono text-xs text-foreground">
                          {c.organizationId}
                        </code>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-mono">{formatNumber(c.reads)}</span>
                        <span className="w-12 text-right font-mono text-muted-foreground">
                          {Math.round(c.pct * 100)}%
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-right text-[10px] text-muted-foreground">
            Lectures comptabilisées via instrumentation BaseRepository (findById,
            findMany, count, exists, findOne). Les requêtes ad-hoc
            <code className="font-mono"> db.collection().get()</code> qui n&apos;appellent
            pas explicitement
            <code className="font-mono"> trackFirestoreReads()</code> ne sont pas
            comptées — l&apos;ordre de grandeur reste fidèle, l&apos;exactitude
            dépend de la couverture d&apos;instrumentation.
          </p>
        </>
      )}
    </div>
  );
}

function DailyBars({ daily }: { daily: Array<{ day: string; reads: number }> }) {
  const max = Math.max(1, ...daily.map((d) => d.reads));
  return (
    <div
      className="flex h-24 items-end gap-1"
      role="img"
      aria-label="Histogramme des lectures Firestore par jour"
    >
      {daily.map((d) => (
        <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-full w-full items-end">
            <div
              className="w-full bg-teranga-gold/70 transition-colors hover:bg-teranga-gold"
              style={{ height: `${Math.max(2, (d.reads / max) * 100)}%` }}
              title={`${d.day} : ${d.reads.toLocaleString("fr-FR")} lectures`}
            />
          </div>
          <span className="text-[9px] font-mono text-muted-foreground">{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
