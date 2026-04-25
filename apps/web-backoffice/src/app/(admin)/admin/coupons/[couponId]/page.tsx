"use client";

import Link from "next/link";
import { use, useState } from "react";
import {
  Badge,
  Card,
  CardContent,
  Spinner,
  InlineErrorBanner,
} from "@teranga/shared-ui";
import { ChevronLeft, ChevronRight, Receipt, Building2 } from "lucide-react";
import type { CouponRedemption } from "@teranga/shared-types";
import { CouponForm } from "@/components/coupons/CouponForm";
import { useAdminCoupon, useAdminCouponRedemptions } from "@/hooks/use-admin";
import { EntityDetailLayout, type EntityTab } from "@/components/admin/entity-detail-layout";

/**
 * Phase 7+ closure — admin coupon detail refactored onto
 * <EntityDetailLayout>. Two tabs:
 *   - Aperçu     → existing edit form (immutable code/discount preserved)
 *   - Rédemptions → paginated redemption history with aggregate footer
 *
 * The lifecycle of a coupon (create / edit / archive) lived on a bespoke
 * scaffold that hid every redemption from operators — they had to drill
 * into the coupon's `usedCount` to know if anyone had actually used it.
 * Surfacing the per-org redemption rows + total discount applied gives
 * Customer Success the answer they always have to compute by hand.
 */
export default function AdminEditCouponPage(props: {
  params: Promise<{ couponId: string }>;
}) {
  const { couponId } = use(props.params);
  const { data, isLoading, isError, error, refetch } = useAdminCoupon(couponId);
  const coupon = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
        <Spinner />
      </div>
    );
  }

  if (isError || !coupon) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Impossible de charger le coupon"
          description={error instanceof Error ? error.message : "Coupon introuvable."}
          actions={[
            {
              label: "Réessayer",
              onClick: () => void refetch(),
            },
          ]}
        />
      </div>
    );
  }

  const tabs: EntityTab[] = [
    {
      id: "overview",
      label: "Aperçu",
      render: () => (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Modifier le libellé, la portée ou les plafonds. Le code, le type et la valeur de la
            remise sont figés à la création (garantit l&apos;intégrité des rédemptions passées).
          </p>
          <CouponForm mode="edit" coupon={coupon} />
        </div>
      ),
    },
    {
      id: "redemptions",
      label: "Rédemptions",
      count: coupon.usedCount,
      render: () => <RedemptionsTab couponId={coupon.id} />,
    },
  ];

  return (
    <EntityDetailLayout
      breadcrumbs={[
        { label: "Administration", href: "/admin" },
        { label: "Coupons", href: "/admin/coupons" },
        { label: coupon.code },
      ]}
      title={`Coupon ${coupon.code}`}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-2 text-xs">
          <code className="font-mono">{coupon.id}</code>
          {coupon.label && (
            <>
              <span aria-hidden="true">·</span>
              <span>{coupon.label}</span>
            </>
          )}
        </span>
      }
      pills={
        <>
          <Badge variant={coupon.isActive ? "success" : "neutral"}>
            {coupon.isActive ? "Actif" : "Archivé"}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {coupon.discountType === "percentage"
              ? `-${coupon.discountValue}%`
              : `-${coupon.discountValue.toLocaleString("fr-FR")} XOF`}
          </Badge>
        </>
      }
      tabs={tabs}
      defaultTabId="overview"
    />
  );
}

// ─── Redemptions tab ─────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function RedemptionsTab({ couponId }: { couponId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useAdminCouponRedemptions(couponId, {
    page,
    limit: PAGE_SIZE,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <InlineErrorBanner
        severity="destructive"
        kicker="— Erreur"
        title="Impossible de charger les rédemptions"
        description={error instanceof Error ? error.message : "Erreur inconnue"}
      />
    );
  }

  const payload = data?.data;
  const rows = payload?.redemptions.data ?? [];
  const meta = payload?.redemptions.meta ?? {
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  };
  const aggregates = payload?.aggregates ?? {
    totalRedemptions: 0,
    totalDiscountAppliedXof: 0,
    byMonth: [],
    byPlan: [],
  };

  if (rows.length === 0 && meta.page === 1) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
          <Receipt className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm font-semibold text-foreground">Aucune rédemption</div>
          <div className="max-w-sm text-xs text-muted-foreground">
            Ce coupon n&apos;a pas encore été utilisé. Les rédemptions apparaîtront ici dès qu&apos;une organisation l&apos;applique à un upgrade.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-1 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total des rédemptions
            </div>
            <div className="text-2xl font-semibold text-teranga-gold">
              {aggregates.totalRedemptions.toLocaleString("fr-FR")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Remise totale appliquée
            </div>
            <div className="text-2xl font-semibold text-teranga-green">
              {aggregates.totalDiscountAppliedXof.toLocaleString("fr-FR")} XOF
            </div>
            {aggregates.totalRedemptions > 500 && (
              <p className="text-[10px] text-amber-600">
                Calcul plafonné aux 500 dernières rédemptions.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sprint-2 S3 — monthly + per-plan breakdown. Renders only
          when there's data, so the empty state above stays clean. */}
      {aggregates.byMonth.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="text-sm font-semibold text-foreground">
              Rédemptions par mois
            </div>
            <RedemptionsByMonthChart data={aggregates.byMonth} />
          </CardContent>
        </Card>
      )}

      {aggregates.byPlan.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="text-sm font-semibold text-foreground">
              Rédemptions par plan
            </div>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Plan</th>
                  <th className="px-3 py-1.5 text-right font-medium">Rédemptions</th>
                  <th className="px-3 py-1.5 text-right font-medium">Remise totale</th>
                </tr>
              </thead>
              <tbody>
                {aggregates.byPlan.map((p) => (
                  <tr key={p.planId} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs">{p.planId}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">
                      {p.count.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs text-teranga-green">
                      -{p.discountXof.toLocaleString("fr-FR")} XOF
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="divide-y divide-border rounded-xl border border-border">
        {rows.map((r: CouponRedemption) => (
          <RedemptionRow key={r.id} row={r} />
        ))}
      </div>

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {meta.page} sur {meta.totalPages} ({meta.total} rédemption
            {meta.total > 1 ? "s" : ""})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.page <= 1}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Précédent
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={meta.page >= meta.totalPages}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Page suivante"
            >
              Suivant
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RedemptionRow({ row }: { row: CouponRedemption }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <Link
          href={`/admin/organizations/${encodeURIComponent(row.organizationId)}`}
          className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-teranga-gold hover:underline"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{row.organizationId}</span>
        </Link>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Plan {row.planId}
          {row.cycle ? ` · ${row.cycle}` : ""} · Appliqué le{" "}
          {new Date(row.redeemedAt).toLocaleString("fr-FR", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </div>
      </div>
      <div className="text-right">
        <div className="font-semibold text-teranga-green">
          -{row.discountAppliedXof.toLocaleString("fr-FR")} XOF
        </div>
        <div className="text-[11px] text-muted-foreground">
          {row.originalPriceXof.toLocaleString("fr-FR")} →{" "}
          {row.finalPriceXof.toLocaleString("fr-FR")} XOF
        </div>
      </div>
    </div>
  );
}


// ─── Sprint-2 S3 — monthly redemptions sparkline ─────────────────────────

function RedemptionsByMonthChart({
  data,
}: {
  data: Array<{ month: string; count: number; discountXof: number }>;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div>
      <div
        className="flex h-24 items-end gap-1"
        role="img"
        aria-label={`Histogramme des rédemptions mensuelles, ${data.length} mois`}
      >
        {data.map((d) => (
          <div key={d.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-full w-full items-end">
              <div
                className="w-full bg-teranga-gold/70 transition-colors hover:bg-teranga-gold"
                style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
                title={`${d.month} : ${d.count} rédemption${d.count > 1 ? "s" : ""} · -${d.discountXof.toLocaleString("fr-FR")} XOF`}
              />
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">{d.month}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
