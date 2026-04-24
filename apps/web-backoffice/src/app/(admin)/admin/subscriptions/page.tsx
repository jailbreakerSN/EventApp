"use client";

/**
 * Phase F (P7 closure) — Subscriptions observability.
 *
 * Deliberately a thin landing page: subscription mutations belong to the
 * org-detail AssignPlanDialog flow already shipped in /admin/organizations.
 * This page surfaces aggregate counts + a deep-link to the revenue
 * dashboard so the sidebar entry is honest (not "Bientôt") without
 * duplicating the mutation surface.
 */

import Link from "next/link";
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
} from "@teranga/shared-ui";
import { Receipt, ArrowRight } from "lucide-react";
import { api } from "@/lib/api-client";
import { CsvExportButton } from "@/components/admin/csv-export-button";

interface RevenueSnapshot {
  activeSubscriptions: number;
  byPlan: Record<string, { count: number }>;
}

export default function AdminSubscriptionsPage() {
  const [data, setData] = useState<RevenueSnapshot | null>(null);

  const fetchData = useCallback(async () => {
    const res = await api.get<{ success: boolean; data: RevenueSnapshot }>("/v1/admin/revenue");
    setData(res.data);
  }, []);

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
