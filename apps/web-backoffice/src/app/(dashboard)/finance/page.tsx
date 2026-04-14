"use client";

import { useState } from "react";
import { ArrowDownRight, TrendingUp, Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useOrgPayouts } from "@/hooks/use-payouts";
import {
  Button,
  Card,
  CardContent,
  Spinner,
  Badge,
  EmptyState,
  DataTable,
  type DataTableColumn,
} from "@teranga/shared-ui";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" }).format(amount);

const PAYOUT_STATUS: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "destructive" }
> = {
  pending: { label: "En attente", variant: "warning" },
  processing: { label: "En cours", variant: "default" },
  completed: { label: "Effectue", variant: "success" },
  failed: { label: "Echoue", variant: "destructive" },
};

export default function FinancePage() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const [page, setPage] = useState(1);

  const { data, isLoading } = useOrgPayouts(orgId ?? undefined, { page, limit: 20 });
  const payouts = data?.data ?? [];
  const meta = data?.meta;

  const totalCompleted = payouts
    .filter((p) => p.status === "completed")
    .reduce((sum, p) => sum + p.netAmount, 0);

  const totalPending = payouts
    .filter((p) => p.status === "pending" || p.status === "processing")
    .reduce((sum, p) => sum + p.netAmount, 0);

  const totalFees = payouts.reduce((sum, p) => sum + p.platformFee, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Finances</h1>
        <p className="text-muted-foreground">Historique des versements et revenus</p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-green-100 p-2">
              <ArrowDownRight className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Revenus verses</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(totalCompleted)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-amber-100 p-2">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">En attente</p>
              <p className="text-xl font-bold text-amber-600">{formatCurrency(totalPending)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-blue-100 p-2">
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Frais plateforme</p>
              <p className="text-xl font-bold text-blue-600">{formatCurrency(totalFees)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payouts table */}
      <Card>
        <CardContent className="py-4">
          <h2 className="mb-4 text-lg font-semibold">Historique des versements</h2>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : payouts.length === 0 ? (
            <EmptyState
              icon={ArrowDownRight}
              title="Aucun versement pour le moment"
              description="Vos revenus s'afficheront ici après la clôture du premier événement payant."
            />
          ) : (
            <DataTable<(typeof payouts)[number] & Record<string, unknown>>
              aria-label="Historique des versements"
              responsiveCards
              data={payouts as ((typeof payouts)[number] & Record<string, unknown>)[]}
              columns={
                [
                  {
                    key: "period",
                    header: "Periode",
                    primary: true,
                    render: (p) => (
                      <span>
                        {new Date(p.periodFrom).toLocaleDateString("fr-FR")} —{" "}
                        {new Date(p.periodTo).toLocaleDateString("fr-FR")}
                      </span>
                    ),
                  },
                  {
                    key: "totalAmount",
                    header: "Brut",
                    render: (p) => formatCurrency(p.totalAmount),
                  },
                  {
                    key: "platformFee",
                    header: "Frais",
                    hideOnMobile: true,
                    render: (p) => (
                      <span className="text-muted-foreground">{formatCurrency(p.platformFee)}</span>
                    ),
                  },
                  {
                    key: "netAmount",
                    header: "Net",
                    render: (p) => (
                      <span className="font-medium">{formatCurrency(p.netAmount)}</span>
                    ),
                  },
                  {
                    key: "status",
                    header: "Statut",
                    render: (p) => {
                      const status = PAYOUT_STATUS[p.status] ?? PAYOUT_STATUS.pending;
                      return <Badge variant={status.variant}>{status.label}</Badge>;
                    },
                  },
                  {
                    key: "createdAt",
                    header: "Date",
                    hideOnMobile: true,
                    render: (p) => (
                      <span className="text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString("fr-FR")}
                      </span>
                    ),
                  },
                ] as DataTableColumn<(typeof payouts)[number] & Record<string, unknown>>[]
              }
            />
          )}

          {meta && meta.totalPages > 1 && (
            <div className="mt-4 flex justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Precedent
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} / {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Suivant
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
