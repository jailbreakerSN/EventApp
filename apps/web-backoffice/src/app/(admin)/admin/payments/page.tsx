"use client";

/**
 * Admin finance-ops — cross-org payments list.
 *
 * Was needed because the inbox card `payments.failed` linked to
 * `/admin/audit?action=payment.failed`, but the inbox count is read
 * from the `payments` collection directly. Any failed payment that
 * predated the audit listener (or came from a seeded fixture) landed
 * the operator on an empty audit view with no way to see the row
 * that triggered the alert.
 *
 * This page is the canonical surface for the `payments.failed` card
 * and a general finance-ops drill-down. Mirrors the pattern in
 * `/admin/venues` — filter + table, no mutation (refunds live on the
 * event-detail finance tab where the payment context is richer).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  Badge,
  Button,
  Select,
  DataTable,
  type DataTableColumn,
} from "@teranga/shared-ui";
import { Coins, CheckCircle2, XCircle, Clock, RefreshCcw } from "lucide-react";
import type { Payment, PaymentStatus, PaymentMethod } from "@teranga/shared-types";
import { useAdminPayments } from "@/hooks/use-admin";

const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "pending", label: "En attente" },
  { value: "succeeded", label: "Succès" },
  { value: "failed", label: "Échoué" },
  { value: "refunded", label: "Remboursé" },
] as const;

const METHOD_OPTIONS = [
  { value: "", label: "Toutes les méthodes" },
  { value: "wave", label: "Wave" },
  { value: "orange_money", label: "Orange Money" },
  { value: "free_money", label: "Free Money" },
  { value: "card", label: "Carte" },
  { value: "cash", label: "Espèces" },
] as const;

const STATUS_BADGE: Record<
  string,
  {
    variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline";
    icon: typeof CheckCircle2;
    label: string;
  }
> = {
  pending: { variant: "warning", icon: Clock, label: "En attente" },
  succeeded: { variant: "success", icon: CheckCircle2, label: "Succès" },
  failed: { variant: "destructive", icon: XCircle, label: "Échoué" },
  refunded: { variant: "outline", icon: RefreshCcw, label: "Remboursé" },
};

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
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function AdminPaymentsPage() {
  const router = useRouter();
  // Hydrate filters from the URL so the inbox deep-link
  // `/admin/payments?status=failed` lands in the filtered view —
  // same pattern as /admin/venues + /admin/organizations.
  const searchParams = useSearchParams();
  const initialStatus = searchParams?.get("status") ?? "";
  const initialMethod = searchParams?.get("method") ?? "";
  const [status, setStatus] = useState(initialStatus);
  const [method, setMethod] = useState(initialMethod);
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useAdminPayments({
    status: (status || undefined) as PaymentStatus | undefined,
    method: (method || undefined) as PaymentMethod | undefined,
    page,
    limit,
  });

  const payments: Payment[] = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit, total: 0, totalPages: 1 };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Paiements</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-center gap-3">
        <Coins className="h-7 w-7 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-foreground">Paiements</h1>
        {status === "failed" && (
          <Badge variant="destructive" className="ml-1">
            Filtre : échoués
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Vue finance-ops cross-organisations. Les remboursements se font depuis la fiche de
        l&apos;événement où le paiement a été émis.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="w-full sm:w-56">
          <label
            htmlFor="pay-status"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Statut
          </label>
          <Select
            id="pay-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrer par statut"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <label
            htmlFor="pay-method"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Méthode
          </label>
          <Select
            id="pay-method"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrer par méthode"
          >
            {METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable<Payment & Record<string, unknown>>
            aria-label="Liste des paiements"
            emptyMessage="Aucun paiement trouvé"
            responsiveCards
            loading={isLoading}
            data={payments as (Payment & Record<string, unknown>)[]}
            onRowClick={(p) => {
              // Event detail is the canonical drill-down for a payment.
              if (p.eventId) {
                router.push(`/admin/events/${encodeURIComponent(p.eventId)}`);
              }
            }}
            columns={
              [
                {
                  key: "status",
                  header: "Statut",
                  primary: true,
                  render: (p) => {
                    const meta = STATUS_BADGE[p.status] ?? STATUS_BADGE.pending;
                    const Icon = meta.icon;
                    return (
                      <Badge variant={meta.variant} className="gap-1">
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {meta.label}
                      </Badge>
                    );
                  },
                },
                {
                  key: "amount",
                  header: "Montant",
                  render: (p) => (
                    <span className="font-semibold text-foreground whitespace-nowrap">
                      {fmtXof(p.amount)}
                    </span>
                  ),
                },
                {
                  key: "method",
                  header: "Méthode",
                  hideOnMobile: true,
                  render: (p) => <Badge variant="outline">{p.method}</Badge>,
                },
                {
                  key: "organization",
                  header: "Organisation",
                  hideOnMobile: true,
                  render: (p) => (
                    <Link
                      href={`/admin/organizations/${encodeURIComponent(p.organizationId)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs text-muted-foreground hover:text-teranga-gold hover:underline"
                    >
                      {p.organizationId.slice(0, 12)}
                      {p.organizationId.length > 12 ? "…" : ""}
                    </Link>
                  ),
                },
                {
                  key: "failureReason",
                  header: "Motif",
                  hideOnMobile: true,
                  render: (p) => (
                    <span className="text-xs text-muted-foreground">
                      {p.failureReason ?? "—"}
                    </span>
                  ),
                },
                {
                  key: "initiatedAt",
                  header: "Date",
                  render: (p) => (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(p.initiatedAt)}
                    </span>
                  ),
                },
              ] as DataTableColumn<Payment & Record<string, unknown>>[]
            }
          />
        </CardContent>
      </Card>

      {!isLoading && meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} sur {meta.totalPages} ({meta.total} paiement
            {meta.total > 1 ? "s" : ""})
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Page précédente"
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={page >= meta.totalPages}
              aria-label="Page suivante"
            >
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
