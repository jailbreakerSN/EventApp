"use client";

import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { CreditCard } from "lucide-react";
import { PlanForm } from "@/components/plans/PlanForm";

export default function AdminNewPlanPage() {
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
            <BreadcrumbPage>Nouveau plan</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-3">
        <CreditCard className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nouveau plan</h1>
          <p className="text-sm text-muted-foreground">
            Créez un plan personnalisé pour une organisation ou un segment spécifique.
          </p>
        </div>
      </div>

      <PlanForm mode="create" />
    </div>
  );
}
