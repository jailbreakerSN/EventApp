"use client";

import { useQuery } from "@tanstack/react-query";
import { organizationsApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import {
  type OrganizationPlan,
  type PlanFeature,
  type PlanUsage,
  PLAN_LIMITS,
} from "@teranga/shared-types";

interface LimitCheck {
  allowed: boolean;
  current: number;
  limit: number;
  percent: number;
}

export function usePlanGating() {
  const { user } = useAuth();
  const { data: orgData } = useOrganization();
  const org = orgData?.data;
  const orgId = user?.organizationId;

  const { data: usageData, isLoading } = useQuery({
    queryKey: ["plan-usage", orgId],
    queryFn: () => organizationsApi.getUsage(orgId!),
    enabled: !!orgId,
    staleTime: 60_000, // cache for 1 minute
  });

  const plan: OrganizationPlan = org?.plan ?? "free";
  const limits = PLAN_LIMITS[plan];
  const usage: PlanUsage | undefined = usageData?.data;

  function canUse(feature: PlanFeature): boolean {
    return limits.features[feature];
  }

  function checkLimit(resource: "events" | "members"): LimitCheck {
    if (!usage) {
      return { allowed: true, current: 0, limit: limits.maxEvents, percent: 0 };
    }
    const data = resource === "events" ? usage.events : usage.members;
    const percent = isFinite(data.limit) ? Math.round((data.current / data.limit) * 100) : 0;
    return {
      allowed: !isFinite(data.limit) || data.current < data.limit,
      current: data.current,
      limit: data.limit,
      percent,
    };
  }

  function isNearLimit(resource: "events" | "members"): boolean {
    const { percent } = checkLimit(resource);
    return percent >= 80;
  }

  return {
    plan,
    usage,
    isLoading,
    canUse,
    checkLimit,
    isNearLimit,
  };
}
