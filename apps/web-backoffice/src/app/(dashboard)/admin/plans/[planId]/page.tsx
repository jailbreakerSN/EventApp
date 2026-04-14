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
import { CreditCard } from "lucide-react";
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

      {plan && <PlanForm mode="edit" plan={plan} />}
    </div>
  );
}
