"use client";

import { useQuery } from "@tanstack/react-query";
import { organizationsApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { type OrganizationPlan, type PlanFeature, type PlanUsage } from "@teranga/shared-types";
import { getEffectiveFeatures, getEffectiveLimits } from "@/hooks/use-plans-catalog";

interface LimitCheck {
  allowed: boolean;
  current: number;
  limit: number;
  percent: number;
}

/**
 * Client-side plan gating. Reads from the org's denormalized effective
 * fields (Phase 2) first — that's the authoritative snapshot that accounts
 * for any per-org override (Phase 5) — with a safe fallback to the legacy
 * PLAN_LIMITS table for orgs that predate the Phase 2 backfill.
 *
 * Usage lookups go through the API (/v1/organizations/:orgId/usage) which
 * already resolves limits from the effective snapshot server-side.
 */
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
  const features = getEffectiveFeatures(org);
  const localLimits = getEffectiveLimits(org); // used only for display when usage isn't loaded yet
  const usage: PlanUsage | undefined = usageData?.data;

  function canUse(feature: PlanFeature): boolean {
    return features[feature];
  }

  function checkLimit(resource: "events" | "members"): LimitCheck {
    if (!usage) {
      const fallbackLimit = resource === "events" ? localLimits.maxEvents : localLimits.maxMembers;
      return { allowed: true, current: 0, limit: fallbackLimit, percent: 0 };
    }
    const data = resource === "events" ? usage.events : usage.members;
    // ─── Defensive percent math ─────────────────────────────────────────────
    // The UI renders `{percent}%` directly into a meter label, so we MUST
    // return a finite value in [0, 100]. Three edge cases to neutralise:
    //   - limit <= 0 → division-by-zero (Infinity or NaN). Can happen on
    //     a custom plan override with maxEvents: 0. Treat as "at cap".
    //   - current < 0 → shouldn't happen but guard anyway (negative UI).
    //   - current > limit → over-cap (server should block new creates but
    //     existing rows may exceed during a downgrade). Clamp to 100.
    //   - limit === Infinity → unlimited plan; percent stays 0 so the
    //     sidebar meter stays empty rather than rendering `0%` of ∞.
    let percent = 0;
    if (Number.isFinite(data.limit) && data.limit > 0) {
      const raw = Math.round((Math.max(0, data.current) / data.limit) * 100);
      percent = Math.min(100, Math.max(0, raw));
    }
    const allowed = !Number.isFinite(data.limit) || (data.limit > 0 && data.current < data.limit);
    return {
      allowed,
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
