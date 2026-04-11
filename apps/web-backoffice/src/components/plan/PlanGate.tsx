"use client";

import { type ReactNode } from "react";
import { type PlanFeature, PLAN_DISPLAY } from "@teranga/shared-types";
import { usePlanGating } from "@/hooks/use-plan-gating";
import { Lock, ArrowUpRight } from "lucide-react";
import Link from "next/link";

interface PlanGateProps {
  feature: PlanFeature;
  fallback?: "blur" | "hidden" | "disabled";
  children: ReactNode;
}

export function PlanGate({ feature, fallback = "blur", children }: PlanGateProps) {
  const { canUse, plan } = usePlanGating();

  if (canUse(feature)) {
    return <>{children}</>;
  }

  if (fallback === "hidden") {
    return null;
  }

  // Find the minimum plan that includes this feature
  const requiredPlan =
    (["starter", "pro", "enterprise"] as const).find(
      (p) => PLAN_DISPLAY[p].limits.features[feature],
    ) ?? "pro";

  const planName = PLAN_DISPLAY[requiredPlan].name.fr;

  if (fallback === "disabled") {
    return (
      <div className="relative opacity-50 pointer-events-none select-none" aria-disabled="true">
        {children}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-md text-xs font-medium">
          <Lock className="h-3 w-3" />
          {planName}
        </div>
      </div>
    );
  }

  // fallback === "blur" — soft wall
  return (
    <div className="relative">
      <div className="blur-sm pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-[1px] rounded-xl">
        <Lock className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground mb-1">
          Disponible avec le plan {planName}
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Votre plan actuel : {PLAN_DISPLAY[plan].name.fr}
        </p>
        <Link
          href="/organization/billing"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
        >
          Passer au plan supérieur
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
