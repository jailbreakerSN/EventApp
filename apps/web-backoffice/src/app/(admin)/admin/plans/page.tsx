"use client";

import { useState } from "react";
import Link from "next/link";
import { useAdminPlans, useArchivePlan } from "@/hooks/use-admin";
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
import { CreditCard, Archive, Pencil, Plus, Lock } from "lucide-react";
import type { Plan, PricingModel } from "@teranga/shared-types";
import { PLAN_LIMIT_UNLIMITED } from "@teranga/shared-types";
import { toast } from "sonner";
import { CsvExportButton } from "@/components/admin/csv-export-button";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLimit(n: number): string {
  return n === PLAN_LIMIT_UNLIMITED ? "∞" : n.toLocaleString("fr-FR");
}

// Fallback for legacy plan docs that haven't been re-seeded yet: infer the
// pricing model from priceXof. Once the next seed-plans run completes on
// staging/production every doc will carry the explicit field.
function resolvePricingModel(plan: Plan): PricingModel {
  if (plan.pricingModel) return plan.pricingModel;
  return plan.priceXof > 0 ? "fixed" : "free";
}

function formatPrice(plan: Plan): string {
  const model = resolvePricingModel(plan);
  switch (model) {
    case "free":
      return "Gratuit";
    case "custom":
      return "Sur devis";
    case "metered":
      return plan.priceXof > 0
        ? `À l'usage · base ${plan.priceXof.toLocaleString("fr-FR")} XOF`
        : "À l'usage";
    case "fixed":
    default:
      return `${plan.priceXof.toLocaleString("fr-FR")} XOF`;
  }
}

function countEnabledFeatures(features: Plan["features"]): number {
  return Object.values(features).filter(Boolean).length;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminPlansPage() {
  const [includeArchived, setIncludeArchived] = useState(true);
  const { data, isLoading } = useAdminPlans({ includeArchived });
  const archivePlan = useArchivePlan();

  const plans: Plan[] = data?.data ?? [];

  const handleArchive = (plan: Plan) => {
    if (plan.isSystem) {
      toast.error("Les plans système ne peuvent pas être archivés.");
      return;
    }
    if (!window.confirm(`Archiver le plan « ${plan.name.fr} » ?`)) return;
    archivePlan.mutate(plan.id, {
      onSuccess: () => toast.success(`Plan « ${plan.name.fr} » archivé`),
      onError: (err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Échec de l'archivage"),
    });
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Tableau de bord</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Plans</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <CreditCard className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Catalogue des plans</h1>
            <p className="text-sm text-muted-foreground">
              Gérez les plans tarifaires et les fonctionnalités disponibles pour chaque
              organisation.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CsvExportButton
            resource="plans"
            filters={includeArchived ? "includeArchived=true" : ""}
          />
          <Link
            href="/admin/plans/analytics"
            className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-background px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 transition-colors"
          >
            Voir l&apos;analytique
          </Link>
          <Link
            href="/admin/plans/new"
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nouveau plan
          </Link>
        </div>
      </div>

      {/* Filter toggle */}
      <div className="flex items-center gap-3">
        <Switch
          checked={includeArchived}
          onCheckedChange={setIncludeArchived}
          label="Afficher les plans archivés"
        />
        <span className="text-sm text-muted-foreground">Afficher les plans archivés</span>
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <DataTable<Plan & Record<string, unknown>>
            aria-label="Liste des plans"
            emptyMessage="Aucun plan dans le catalogue. Lancez scripts/seed-plans.ts pour initialiser."
            responsiveCards
            loading={isLoading}
            data={plans as (Plan & Record<string, unknown>)[]}
            columns={
              [
                {
                  key: "name",
                  header: "Plan",
                  primary: true,
                  render: (plan) => (
                    <div>
                      <p className="flex items-center gap-2 font-medium text-foreground">
                        {plan.name.fr}
                        {plan.isSystem && (
                          <Lock
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-label="Plan système — protégé"
                          />
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{plan.key}</p>
                    </div>
                  ),
                },
                {
                  key: "price",
                  header: "Prix",
                  render: (plan) => (
                    <span className="font-medium text-foreground">{formatPrice(plan)}</span>
                  ),
                },
                {
                  key: "limits",
                  header: "Limites",
                  hideOnMobile: true,
                  render: (plan) => (
                    <div className="text-xs space-y-0.5">
                      <div>
                        <span className="text-muted-foreground">Évt :</span>{" "}
                        <span className="font-medium">{formatLimit(plan.limits.maxEvents)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Part./évt :</span>{" "}
                        <span className="font-medium">
                          {formatLimit(plan.limits.maxParticipantsPerEvent)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Membres :</span>{" "}
                        <span className="font-medium">{formatLimit(plan.limits.maxMembers)}</span>
                      </div>
                    </div>
                  ),
                },
                {
                  key: "features",
                  header: "Fonctionnalités",
                  hideOnMobile: true,
                  render: (plan) => (
                    <Badge variant="info">{countEnabledFeatures(plan.features)} / 11</Badge>
                  ),
                },
                {
                  key: "visibility",
                  header: "Visibilité",
                  render: (plan) => {
                    if (plan.isArchived) return <Badge variant="destructive">Archivé</Badge>;
                    if (!plan.isPublic) return <Badge variant="neutral">Privé</Badge>;
                    return <Badge variant="success">Public</Badge>;
                  },
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (plan) => (
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/plans/${plan.id}`}
                        aria-label={`Modifier ${plan.name.fr}`}
                        className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Modifier
                      </Link>
                      {!plan.isSystem && !plan.isArchived && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleArchive(plan)}
                          disabled={archivePlan.isPending}
                          aria-label={`Archiver ${plan.name.fr}`}
                        >
                          <Archive className="h-3.5 w-3.5 mr-1" />
                          Archiver
                        </Button>
                      )}
                    </div>
                  ),
                },
              ] as DataTableColumn<Plan & Record<string, unknown>>[]
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
