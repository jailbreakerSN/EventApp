"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  QueryError,
  Spinner,
} from "@teranga/shared-ui";
import { CreditCard, History } from "lucide-react";
import { useAdminPlan } from "@/hooks/use-admin";
import { PlanForm } from "@/components/plans/PlanForm";

export default function AdminEditPlanPage() {
  const params = useParams<{ planId: string }>();
  const planId = params?.planId;
  const { data, isLoading, isError, error, refetch } = useAdminPlan(planId);
  const plan = data?.data;

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
            <BreadcrumbLink asChild>
              <Link href="/admin/plans">Plans</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{plan?.name.fr ?? planId ?? "Plan"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-3">
        <CreditCard className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {plan ? `Modifier « ${plan.name.fr} »` : "Modifier le plan"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Ajustez les limites, les fonctionnalités ou le prix de ce plan.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
          <Spinner />
        </div>
      )}

      {isError && (
        <QueryError
          title="Impossible de charger le plan"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {plan && (
        <>
          {/* Phase 7: warn editors that price / limits / features edits mint a
              NEW version. Existing subscribers stay on their current version
              (grandfathered); only new signups get the new one. */}
          <div
            role="note"
            className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"
          >
            <History className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Version actuelle : v{plan.version ?? 1}</p>
              <p className="text-muted-foreground">
                Modifier le prix, les limites ou les fonctionnalités créera une
                <strong className="text-foreground"> nouvelle version</strong>. Les organisations
                déjà abonnées restent sur leur version actuelle (droits préservés). Seuls les
                nouveaux abonnements utiliseront la nouvelle version.
              </p>
              <p className="text-muted-foreground">
                Les ajustements d&apos;ordre d&apos;affichage ou de visibilité n&apos;affectent pas
                la version.
              </p>
            </div>
          </div>
          <PlanForm mode="edit" plan={plan} />
        </>
      )}
    </div>
  );
}
