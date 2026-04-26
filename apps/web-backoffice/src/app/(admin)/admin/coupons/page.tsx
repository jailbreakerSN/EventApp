"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  useAdminCoupons,
  useArchiveCoupon,
} from "@/hooks/use-admin";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  Button,
  Badge,
  Switch,
  DataTable,
  type DataTableColumn,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { Tag, Archive, Pencil, Plus } from "lucide-react";
import type { PlanCoupon } from "@teranga/shared-types";
import { toast } from "sonner";

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatDiscount(coupon: PlanCoupon): string {
  return coupon.discountType === "percentage"
    ? `-${coupon.discountValue} %`
    : `-${coupon.discountValue.toLocaleString("fr-FR")} XOF`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatUses(coupon: PlanCoupon): string {
  const max = coupon.maxUses === null ? "∞" : coupon.maxUses.toLocaleString("fr-FR");
  return `${coupon.usedCount.toLocaleString("fr-FR")} / ${max}`;
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function AdminCouponsPage() {
  const [onlyActive, setOnlyActive] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Reset to page 1 whenever the filter changes — otherwise the user could
  // sit on page 4 of the unfiltered list while flipping the active toggle.
  useEffect(() => {
    setPage(1);
  }, [onlyActive]);

  const { data, isLoading } = useAdminCoupons({
    isActive: onlyActive ? true : undefined,
    page,
    limit,
  });
  const archive = useArchiveCoupon();

  const coupons: PlanCoupon[] = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit, total: 0, totalPages: 1 };

  const handleArchive = (coupon: PlanCoupon) => {
    if (!window.confirm(`Archiver le coupon « ${coupon.code} » ?`)) return;
    archive.mutate(coupon.id, {
      onSuccess: () => toast.success(`Coupon « ${coupon.code} » archivé`),
      onError: (err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Échec de l'archivage"),
    });
  };

  return (
    <div className="space-y-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Coupons</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Tag className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Coupons d&apos;abonnement
            </h1>
            <p className="text-sm text-muted-foreground">
              Codes promotionnels applicables aux upgrades de plan. Distincts des codes promo
              événement (tickets).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/coupons/new"
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nouveau coupon
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          checked={onlyActive}
          onCheckedChange={setOnlyActive}
          label="N'afficher que les coupons actifs"
        />
        <span className="text-sm text-muted-foreground">
          N&apos;afficher que les coupons actifs
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable<PlanCoupon & Record<string, unknown>>
            aria-label="Liste des coupons d'abonnement"
            emptyMessage="Aucun coupon créé pour le moment."
            responsiveCards
            loading={isLoading}
            data={coupons as (PlanCoupon & Record<string, unknown>)[]}
            columns={
              [
                {
                  key: "code",
                  header: "Code",
                  primary: true,
                  render: (c) => (
                    <div>
                      <p className="font-mono font-medium text-foreground">{c.code}</p>
                      {c.label ? (
                        <p className="text-xs text-muted-foreground">{c.label}</p>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: "discount",
                  header: "Remise",
                  render: (c) => (
                    <span className="font-medium text-foreground">{formatDiscount(c)}</span>
                  ),
                },
                {
                  key: "scope",
                  header: "Portée",
                  hideOnMobile: true,
                  render: (c) => {
                    const plans =
                      c.appliedPlanIds && c.appliedPlanIds.length > 0
                        ? `${c.appliedPlanIds.length} plan(s)`
                        : "Tous les plans";
                    const cycles =
                      c.appliedCycles && c.appliedCycles.length > 0
                        ? c.appliedCycles.join(", ")
                        : "tous";
                    return (
                      <div className="text-xs space-y-0.5">
                        <div>{plans}</div>
                        <div className="text-muted-foreground">Cycles : {cycles}</div>
                      </div>
                    );
                  },
                },
                {
                  key: "uses",
                  header: "Utilisations",
                  render: (c) => (
                    <span className="text-sm font-medium text-foreground">{formatUses(c)}</span>
                  ),
                },
                {
                  key: "expires",
                  header: "Expire",
                  hideOnMobile: true,
                  render: (c) => (
                    <span className="text-sm text-muted-foreground">{formatDate(c.expiresAt)}</span>
                  ),
                },
                {
                  key: "status",
                  header: "Statut",
                  render: (c) =>
                    c.isActive ? (
                      <Badge variant="success">Actif</Badge>
                    ) : (
                      <Badge variant="neutral">Archivé</Badge>
                    ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (c) => (
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/coupons/${c.id}`}
                        aria-label={`Modifier ${c.code}`}
                        className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Modifier
                      </Link>
                      {c.isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleArchive(c)}
                          disabled={archive.isPending}
                          aria-label={`Archiver ${c.code}`}
                        >
                          <Archive className="h-3.5 w-3.5 mr-1" />
                          Archiver
                        </Button>
                      )}
                    </div>
                  ),
                },
              ] as DataTableColumn<PlanCoupon & Record<string, unknown>>[]
            }
          />
        </CardContent>
      </Card>

      {meta.totalPages > 1 ? (
        <nav
          aria-label="Pagination des coupons"
          className="flex items-center justify-between gap-3 pt-2"
        >
          <p className="text-sm text-muted-foreground" aria-current="page">
            Page {meta.page} sur {meta.totalPages} ({meta.total} coupon
            {meta.total > 1 ? "s" : ""})
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.page <= 1 || isLoading}
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-4 w-4" />
              Précédent
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={meta.page >= meta.totalPages || isLoading}
              aria-label="Page suivante"
            >
              Suivant
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
