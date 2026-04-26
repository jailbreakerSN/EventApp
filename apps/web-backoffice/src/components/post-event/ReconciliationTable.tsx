"use client";

/**
 * Organizer overhaul — Phase O9.
 *
 * Reconciliation matrix — one row per `(method, status)` group with
 * count + gross + refunded + net columns. Sticky header on scroll, FR
 * labels via the helpers, monetary columns right-aligned + tabular
 * nums for vertical alignment.
 *
 * Empty state ("Aucun paiement à rapprocher") for events with zero
 * payments — the financial cards above already reflect this.
 */

import { Card, CardContent, Skeleton } from "@teranga/shared-ui";
import { Coins } from "lucide-react";
import { formatPaymentMethod, formatPaymentStatus, formatXof } from "./helpers";
import { cn } from "@/lib/utils";
import type { ReconciliationSummary } from "@teranga/shared-types";

export function ReconciliationTable({
  data,
  isLoading,
}: {
  data: ReconciliationSummary | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton variant="rectangle" className="h-64" />;
  }
  if (!data || data.rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground space-y-2">
          <Coins className="h-6 w-6 mx-auto opacity-60" aria-hidden="true" />
          <p>Aucun paiement à rapprocher pour cet événement.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground bg-muted/40">
              <tr>
                <Th>Moyen</Th>
                <Th>Statut</Th>
                <Th align="right">Quantité</Th>
                <Th align="right">Brut</Th>
                <Th align="right">Remboursé</Th>
                <Th align="right">Net</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={`${r.method}-${r.status}`}
                  className="border-t border-border last:border-b-0"
                >
                  <Td>{formatPaymentMethod(r.method)}</Td>
                  <Td>
                    <StatusPill status={r.status} />
                  </Td>
                  <Td align="right">{r.count}</Td>
                  <Td align="right">{formatXof(r.totalAmount)}</Td>
                  <Td align="right">{formatXof(r.refundedAmount)}</Td>
                  <Td align="right" bold>
                    {formatXof(r.netAmount)}
                  </Td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="border-t-2 border-border bg-muted/40">
                <Td colSpan={2}>Total net</Td>
                <Td align="right">{data.totals.paidRegistrations} payantes</Td>
                <Td align="right">{formatXof(data.totals.grossAmount)}</Td>
                <Td align="right">{formatXof(data.totals.refundedAmount)}</Td>
                <Td align="right" bold>
                  {formatXof(data.totals.netRevenue)}
                </Td>
              </tr>
            </tbody>
          </table>
        </div>
        {data.lastPaymentAt && (
          <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">
            Dernier paiement enregistré :{" "}
            {new Date(data.lastPaymentAt).toLocaleString("fr-FR", {
              dateStyle: "long",
              timeStyle: "short",
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Atoms ────────────────────────────────────────────────────────────────

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th className={cn("px-4 py-2 font-medium", align === "right" && "text-right")} scope="col">
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  bold,
  colSpan,
}: {
  children: React.ReactNode;
  align?: "right";
  bold?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "px-4 py-2 align-middle",
        align === "right" && "text-right tabular-nums",
        bold && "font-semibold",
      )}
    >
      {children}
    </td>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "succeeded"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status === "failed"
        ? "bg-red-500/15 text-red-700 dark:text-red-400"
        : status === "refunded"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
        tone,
      )}
    >
      {formatPaymentStatus(status)}
    </span>
  );
}
