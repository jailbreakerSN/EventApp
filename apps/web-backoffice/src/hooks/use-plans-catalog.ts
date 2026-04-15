"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  PLAN_DISPLAY,
  PLAN_LIMITS,
  PLAN_LIMIT_UNLIMITED,
  type Organization,
  type OrganizationPlan,
  type Plan,
  type PlanFeatures,
  type PricingModel,
} from "@teranga/shared-types";
import { plansApi } from "@/lib/api-client";

// ─── Public Plan Catalog Hook (Phase 6) ─────────────────────────────────────
//
// Single source of truth for "what plans exist in the catalog right now" on
// the client. Replaces direct `PLAN_DISPLAY` imports so custom superadmin-
// created plans render correctly in the UI.
//
// Caching: 5 minutes — the catalog is slow-moving (only changes when
// superadmin edits it). A stale-while-revalidate window is acceptable
// because the data is already denormalized onto each org for enforcement
// (Phase 2). The catalog here is display-only.

const CATALOG_STALE_MS = 5 * 60 * 1000;

export function usePlansCatalog() {
  return useQuery({
    queryKey: ["plans-catalog"],
    queryFn: () => plansApi.listPublic(),
    staleTime: CATALOG_STALE_MS,
  });
}

/**
 * Build a plan-key → Plan map for O(1) display lookup.
 */
export function usePlansCatalogMap() {
  const { data, isLoading, isError } = usePlansCatalog();
  const map = useMemo(() => {
    const out = new Map<string, Plan>();
    for (const p of data?.data ?? []) {
      out.set(p.key, p);
    }
    return out;
  }, [data]);
  return { map, isLoading, isError };
}

// ─── Display helpers with graceful fallback ─────────────────────────────────
//
// The client may render before the catalog fetch resolves (cold load), or
// encounter an org whose plan key is brand-new and not yet in any cache. The
// helpers below always return SOMETHING renderable so UI code never needs to
// defensively null-check.

export interface PlanDisplayInfo {
  key: string;
  name: { fr: string; en: string };
  description?: { fr: string; en: string } | null;
  priceXof: number;
  pricingModel: PricingModel;
}

/**
 * Resolve a plan's display info from the live catalog first, falling back
 * to the legacy hardcoded PLAN_DISPLAY table, and finally to a minimal stub
 * so unknown custom plan keys still render (as their key, uppercased).
 */
export function getPlanDisplay(
  planKey: string | undefined,
  catalog: Map<string, Plan>,
): PlanDisplayInfo {
  if (!planKey) {
    return {
      key: "free",
      name: { fr: "Plan gratuit", en: "Free plan" },
      priceXof: 0,
      pricingModel: "free",
    };
  }

  const fromCatalog = catalog.get(planKey);
  if (fromCatalog) {
    return {
      key: fromCatalog.key,
      name: fromCatalog.name,
      description: fromCatalog.description ?? null,
      priceXof: fromCatalog.priceXof,
      pricingModel: fromCatalog.pricingModel ?? (fromCatalog.priceXof > 0 ? "fixed" : "free"),
    };
  }

  const legacy = PLAN_DISPLAY[planKey as OrganizationPlan];
  if (legacy) {
    return {
      key: planKey,
      name: legacy.name,
      priceXof: legacy.priceXof,
      pricingModel: planKey === "enterprise" ? "custom" : legacy.priceXof > 0 ? "fixed" : "free",
    };
  }

  // Last resort: render the key itself. No crash, no blank UI.
  const humanized = planKey.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    key: planKey,
    name: { fr: humanized, en: humanized },
    priceXof: 0,
    pricingModel: "custom",
  };
}

/**
 * Features for gating UI decisions. Prefers the denormalized
 * `org.effectiveFeatures` (Phase 2) — that's the authoritative snapshot that
 * already accounts for any per-org override (Phase 5). Falls back to the
 * hardcoded table for pre-backfill orgs.
 */
export function getEffectiveFeatures(org: Organization | undefined): PlanFeatures {
  if (org?.effectiveFeatures) return org.effectiveFeatures;
  const fallback = org ? PLAN_LIMITS[org.plan]?.features : undefined;
  // Absolute last resort: free plan features (everything off).
  return fallback ?? PLAN_LIMITS.free.features;
}

/**
 * Runtime (Infinity-aware) effective limits for UI display. Prefers the
 * denormalized org.effectiveLimits, falls back to PLAN_LIMITS[org.plan].
 */
export interface EffectiveLimits {
  maxEvents: number;
  maxParticipantsPerEvent: number;
  maxMembers: number;
}

export function getEffectiveLimits(org: Organization | undefined): EffectiveLimits {
  if (org?.effectiveLimits) {
    const unpack = (n: number) => (n === PLAN_LIMIT_UNLIMITED ? Infinity : n);
    return {
      maxEvents: unpack(org.effectiveLimits.maxEvents),
      maxParticipantsPerEvent: unpack(org.effectiveLimits.maxParticipantsPerEvent),
      maxMembers: unpack(org.effectiveLimits.maxMembers),
    };
  }
  const fallback = org ? PLAN_LIMITS[org.plan] : PLAN_LIMITS.free;
  return {
    maxEvents: fallback.maxEvents,
    maxParticipantsPerEvent: fallback.maxParticipantsPerEvent,
    maxMembers: fallback.maxMembers,
  };
}

/**
 * Convenience: the effective display key the org is currently on. Prefers
 * org.effectivePlanKey (set by Phase 2+3), falls back to org.plan enum.
 */
export function getEffectivePlanKey(org: Organization | undefined): string {
  return org?.effectivePlanKey ?? org?.plan ?? "free";
}
