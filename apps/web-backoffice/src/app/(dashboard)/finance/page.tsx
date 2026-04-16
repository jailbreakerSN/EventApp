"use client";

import { useState } from "react";
import { ArrowDownRight, Banknote, Clock, Landmark, ReceiptText, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useOrgBalance, useOrgBalanceTransactions } from "@/hooks/use-balance";
import { useOrgPayouts } from "@/hooks/use-payouts";
import {
  Button,
  Card,
  CardContent,
  Spinner,
  Badge,
  EmptyState,
  DataTable,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  type DataTableColumn,
} from "@teranga/shared-ui";
import type { BalanceTransaction } from "@teranga/shared-types";

// ─── /finance ───────────────────────────────────────────────────────────────
//
// Balance-view layout (Stripe-inspired). Three header cards answer the
// operator's three questions:
//   - "How much can I withdraw right now?"  → Solde disponible
//   - "How much is coming?"                 → En attente (T+N release)
//   - "How much has moved out?"             → Versé à ce jour (lifetime)
//
// Below: tabs. Transactions (ledger view — every money movement) and
// Versements (the existing payouts history). The payouts tab is retained
// because a payout IS still a user-facing concept (bank statement row),
// it's just no longer the only view into the org's money.

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" }).format(amount);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const PAYOUT_STATUS: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "destructive" }
> = {
  pending: { label: "En attente", variant: "warning" },
  processing: { label: "En cours", variant: "default" },
  completed: { label: "Effectué", variant: "success" },
  failed: { label: "Échoué", variant: "destructive" },
};

// Human-facing label + sign for each ledger kind. Kept close to the page
// so the wording stays consistent with what the balance cards imply.
const LEDGER_KIND_LABEL: Record<BalanceTransaction["kind"], string> = {
  payment: "Paiement reçu",
  platform_fee: "Frais plateforme",
  refund: "Remboursement",
  payout: "Versement bancaire",
  payout_reversal: "Versement annulé",
  adjustment: "Ajustement",
};

const LEDGER_STATUS_LABEL: Record<
  BalanceTransaction["status"],
  { label: string; variant: "default" | "success" | "warning" }
> = {
  pending: { label: "En attente", variant: "warning" },
  available: { label: "Disponible", variant: "success" },
  paid_out: { label: "Versé", variant: "default" },
};

export default function FinancePage() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  const { data: balanceData, isLoading: balanceLoading } = useOrgBalance(orgId ?? undefined);
  const balance = balanceData?.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Finances</h1>
        <p className="text-muted-foreground">
          Solde disponible, historique des mouvements et versements
        </p>
      </div>

      {/* ─── Balance summary cards ─────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        <BalanceCard
          icon={<Banknote className="h-5 w-5 text-green-600" />}
          label="Solde disponible"
          value={balance ? formatCurrency(balance.available) : "—"}
          hint="Retrait possible immédiatement"
          loading={balanceLoading}
          tone="success"
        />
        <BalanceCard
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          label="En attente"
          value={balance ? formatCurrency(balance.pending) : "—"}
          hint="Libéré 7 j après la fin de l'événement"
          loading={balanceLoading}
          tone="warning"
        />
        <BalanceCard
          icon={<Landmark className="h-5 w-5 text-blue-600" />}
          label="Versé à ce jour"
          value={balance ? formatCurrency(balance.lifetimePaidOut) : "—"}
          hint={
            balance?.lastPayoutAt
              ? `Dernier versement : ${formatDate(balance.lastPayoutAt)}`
              : "Aucun versement effectué"
          }
          loading={balanceLoading}
          tone="info"
        />
      </div>

      {/* Secondary lifetime strip */}
      {balance && (
        <p className="text-xs text-muted-foreground">
          Revenus bruts à ce jour : {formatCurrency(balance.lifetimeRevenue)} · Frais plateforme :{" "}
          {formatCurrency(balance.lifetimeFees)} · Remboursés :{" "}
          {formatCurrency(balance.lifetimeRefunded)}
        </p>
      )}

      {/* ─── Tabs: Transactions | Versements ──────────────────────────── */}
      <Tabs defaultValue="transactions">
        <TabsList>
          <TabsTrigger value="transactions">
            <ReceiptText className="mr-2 h-4 w-4" />
            Transactions
          </TabsTrigger>
          <TabsTrigger value="payouts">
            <ArrowDownRight className="mr-2 h-4 w-4" />
            Versements
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <TransactionsTab orgId={orgId ?? undefined} />
        </TabsContent>

        <TabsContent value="payouts">
          <PayoutsTab orgId={orgId ?? undefined} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Balance card ──────────────────────────────────────────────────────────

function BalanceCard({
  icon,
  label,
  value,
  hint,
  loading,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
  tone: "success" | "warning" | "info";
}) {
  const toneClass =
    tone === "success" ? "text-green-600" : tone === "warning" ? "text-amber-600" : "text-blue-600";
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-4">
        <div className="rounded-lg bg-muted p-2">{icon}</div>
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          {loading ? <Spinner /> : <p className={`text-xl font-bold ${toneClass}`}>{value}</p>}
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Transactions tab (ledger view) ────────────────────────────────────────

function TransactionsTab({ orgId }: { orgId: string | undefined }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useOrgBalanceTransactions(orgId, { page, limit: 25 });
  const entries = data?.data ?? [];
  const meta = data?.meta;

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Aucun mouvement pour le moment"
        description="Les paiements, frais et versements apparaîtront ici dès que votre première billetterie payante sera confirmée."
      />
    );
  }

  return (
    <Card>
      <CardContent className="py-4">
        <DataTable<BalanceTransaction & Record<string, unknown>>
          aria-label="Historique des mouvements"
          responsiveCards
          data={entries as (BalanceTransaction & Record<string, unknown>)[]}
          columns={
            [
              {
                key: "date",
                header: "Date",
                primary: true,
                render: (e) => formatDate(e.createdAt),
              },
              {
                key: "kind",
                header: "Type",
                render: (e) => LEDGER_KIND_LABEL[e.kind],
              },
              {
                key: "description",
                header: "Détail",
                hideOnMobile: true,
                render: (e) => (
                  <span className="text-muted-foreground">{e.description || "—"}</span>
                ),
              },
              {
                key: "amount",
                header: "Montant",
                render: (e) => (
                  <span
                    className={`font-medium ${e.amount >= 0 ? "text-green-600" : "text-foreground"}`}
                  >
                    {e.amount >= 0 ? "+" : ""}
                    {formatCurrency(e.amount)}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Statut",
                render: (e) => {
                  const s = LEDGER_STATUS_LABEL[e.status];
                  return <Badge variant={s.variant}>{s.label}</Badge>;
                },
              },
            ] as DataTableColumn<BalanceTransaction & Record<string, unknown>>[]
          }
        />

        {meta && meta.totalPages > 1 && (
          <Pagination page={page} totalPages={meta.totalPages} onChange={setPage} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Payouts tab (existing bank-transfer history) ──────────────────────────

function PayoutsTab({ orgId }: { orgId: string | undefined }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useOrgPayouts(orgId, { page, limit: 20 });
  const payouts = data?.data ?? [];
  const meta = data?.meta;

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (payouts.length === 0) {
    return (
      <EmptyState
        icon={ArrowDownRight}
        title="Aucun versement pour le moment"
        description="Les versements bancaires seront générés en fin de période à partir de votre solde disponible."
      />
    );
  }

  return (
    <Card>
      <CardContent className="py-4">
        <DataTable<(typeof payouts)[number] & Record<string, unknown>>
          aria-label="Historique des versements"
          responsiveCards
          data={payouts as ((typeof payouts)[number] & Record<string, unknown>)[]}
          columns={
            [
              {
                key: "period",
                header: "Période",
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
                render: (p) => <span className="font-medium">{formatCurrency(p.netAmount)}</span>,
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

        {meta && meta.totalPages > 1 && (
          <Pagination page={page} totalPages={meta.totalPages} onChange={setPage} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Pagination (shared by both tabs) ──────────────────────────────────────

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex justify-between">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Précédent
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Suivant
      </Button>
    </div>
  );
}
