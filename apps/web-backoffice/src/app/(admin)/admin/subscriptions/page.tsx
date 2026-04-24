"use client";

/**
 * Phase F (P7 closure) — Subscriptions observability.
 *
 * Thin landing page by design: subscription mutations belong to the
 * org-detail AssignPlanDialog flow shipped in /admin/organizations,
 * and the revenue dashboard owns the consolidated MRR view.
 *
 * 2026-04-24 follow-up — the "X abonnement(s) en impayé" inbox card
 * used to link here without any signal of WHICH subscription was
 * past_due. We now surface a first-class past-due section powered
 * by `adminApi.listSubscriptions({ status: 'past_due' })` — the
 * same data the inbox signal is counting — so the count → list
 * invariant holds end-to-end. Hydrates from `?status=past_due` for
 * deep-link continuity (the inbox now passes that param).
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  Badge,
} from "@teranga/shared-ui";
import { Receipt, ArrowRight, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api-client";
import { useAdminSubscriptions } from "@/hooks/use-admin";
import { CsvExportButton } from "@/components/admin/csv-export-button";
import type { Subscription } from "@teranga/shared-types";

interface RevenueSnapshot {
  activeSubscriptions: number;
  byPlan: Record<string, { count: number }>;
}

function fmtXof(v: number): string {
  try {
    return new Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" }).format(v);
  } catch {
    return `${v} XOF`;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

export default function AdminSubscriptionsPage() {
  const [data, setData] = useState<RevenueSnapshot | null>(null);

  const searchParams = useSearchParams();
  // The inbox card passes `?status=past_due` — surface the past-due
  // list prominently when that's the case. Also fetch past_due
  // unconditionally so the section renders whenever there are
  // impacted subscriptions, regardless of the URL. This keeps the
  // count/list invariant even if an operator navigates here via the
  // sidebar rather than the inbox.
  const highlightPastDue = searchParams?.get("status") === "past_due";

  const fetchData = useCallback(async () => {
    const res = await api.get<{ success: boolean; data: RevenueSnapshot }>("/v1/admin/revenue");
    setData(res.data);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Always fetch past-due subscriptions (limit small — it's an ops
  // exception list, not a browse surface).
  const { data: pastDueRes, isLoading: pastDueLoading } = useAdminSubscriptions({
    status: "past_due",
    limit: 20,
  });
  const pastDue: Subscription[] = pastDueRes?.data ?? [];

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Abonnements</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Billing"
        title="Abonnements"
        subtitle="Vue d'ensemble des abonnements actifs par plan."
        action={<CsvExportButton resource="subscriptions" />}
      />

      {/* Past-due section — pinned at top when the inbox deep-link set
          ?status=past_due, still visible otherwise so ops never miss
          an impayé in the sidebar flow. */}
      {!pastDueLoading && pastDue.length > 0 && (
        <Card
          className={
            highlightPastDue
              ? "border-red-200 dark:border-red-900/50 ring-2 ring-red-200/60 dark:ring-red-900/40"
              : "border-red-200/70 dark:border-red-900/40"
          }
        >
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 text-red-600 dark:text-red-400"
                aria-hidden="true"
              />
              <div className="flex-1">
                <div className="text-sm font-semibold text-foreground">
                  {pastDue.length} abonnement{pastDue.length > 1 ? "s" : ""} en impayé
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Relance en cours. Ouvrir la fiche de l&apos;organisation pour marquer le paiement
                  reçu ou déclencher un downgrade.
                </p>
              </div>
              <Badge variant="destructive" className="uppercase">
                past_due
              </Badge>
            </div>

            <ul className="divide-y divide-border border-t border-border pt-2">
              {pastDue.map((sub) => (
                <li key={sub.id} className="py-2">
                  <Link
                    href={`/admin/organizations/${encodeURIComponent(sub.organizationId)}`}
                    className="flex items-center justify-between gap-3 rounded-sm px-1 py-1 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-foreground">
                        {sub.organizationId}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Plan <strong className="text-foreground">{sub.plan}</strong> —{" "}
                        {fmtXof(sub.priceXof)} / période · fin {formatDate(sub.currentPeriodEnd)}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data && (
        <Card>
          <CardContent className="space-y-3 p-4 text-sm">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-semibold">{data.activeSubscriptions}</span> abonnement(s)
              actif(s)
            </div>
            <ul className="ml-6 space-y-1 text-xs text-muted-foreground">
              {Object.entries(data.byPlan).map(([plan, stats]) => (
                <li key={plan}>
                  · <strong className="text-foreground">{plan}</strong> — {stats.count}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="text-sm font-semibold text-foreground">Gestion des abonnements</div>
          <p className="max-w-md text-xs text-muted-foreground">
            Les mutations d&apos;abonnement (upgrade, downgrade, overrides) se font depuis la fiche
            de l&apos;organisation via <strong>Assigner un plan</strong>. Pour la vue revenu
            consolidée, consultez le tableau de bord Revenus.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/organizations"
              className="inline-flex items-center gap-1 text-sm font-medium text-teranga-gold hover:underline"
            >
              Organisations <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Link
              href="/admin/revenue"
              className="inline-flex items-center gap-1 text-sm font-medium text-teranga-gold hover:underline"
            >
              Tableau revenus <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
