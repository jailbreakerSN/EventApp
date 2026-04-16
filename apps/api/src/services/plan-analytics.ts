import {
  type Organization,
  type Plan,
  type Subscription,
  type PlanAnalytics,
  type PlanAnalyticsMoney,
  type PlanAnalyticsNearLimit,
  type PlanAnalyticsTier,
  type PlanAnalyticsTrialEnding,
  PLAN_LIMIT_UNLIMITED,
} from "@teranga/shared-types";

// ─── Plan Analytics — pure fold (Phase 7+ item #5) ───────────────────────────
//
// Kept separate from the service so it's trivially unit-testable with
// synthetic inputs — no Firestore, no vi.mock, no emulator. The service
// layer is a thin I/O shell around `computePlanAnalytics()`.
//
// Design calls — see the `PlanAnalytics` type in shared-types for the why;
// this file is strictly the math.

const TRIAL_ENDING_WINDOW_DAYS = 7;
const NEAR_LIMIT_THRESHOLD = 0.8;

function emptyMoney(): PlanAnalyticsMoney {
  return { total: 0, byTier: {} };
}

function addMoney(m: PlanAnalyticsMoney, tier: string, amount: number): void {
  m.total += amount;
  m.byTier[tier] = (m.byTier[tier] ?? 0) + amount;
}

function isOverrideActive(sub: Subscription, now: Date): boolean {
  if (!sub.overrides) return false;
  const validUntil = sub.overrides.validUntil;
  if (!validUntil) return true;
  return new Date(validUntil).getTime() > now.getTime();
}

/**
 * Resolve which version of a plan a subscription is pinned to, given a
 * map of plan docs. Returns null when the sub's `planId` doesn't match
 * any catalog doc (legacy / archived lineage). Callers treat null as
 * "unknown version" and skip version-grouped breakdowns for that sub.
 */
function planForSub(sub: Subscription, plansById: Map<string, Plan>): Plan | null {
  if (!sub.planId) return null;
  return plansById.get(sub.planId) ?? null;
}

export interface ComputeInput {
  subscriptions: Subscription[];
  organizations: Organization[];
  plans: Plan[];
  /**
   * Per-org active-event counts. Injected by the service wrapper because
   * the pure fold can't run Firestore queries. Missing entries default
   * to 0 — safe: an org with no known event count simply won't show up
   * in `nearLimitOrgs.events` even if it should.
   */
  activeEventsByOrgId?: Map<string, number>;
  now: Date;
}

export function computePlanAnalytics(input: ComputeInput): PlanAnalytics {
  const { subscriptions, organizations, plans, now } = input;
  const plansById = new Map(plans.map((p) => [p.id, p]));
  const orgsById = new Map(organizations.map((o) => [o.id, o]));

  const mrr = emptyMoney();
  const trialingMRR = emptyMoney();
  const bookings = emptyMoney();
  const tierMix: Record<string, PlanAnalyticsTier> = {};
  const annualVsMonthly = { monthly: 0, annual: 0 };
  let overrideCount = 0;
  const trialsEndingSoon: PlanAnalyticsTrialEnding[] = [];

  const trialWindowEnd = new Date(now.getTime() + TRIAL_ENDING_WINDOW_DAYS * 86_400_000);

  for (const sub of subscriptions) {
    const plan = planForSub(sub, plansById);
    const tier = sub.plan;
    const cycle = sub.billingCycle ?? "monthly";

    // ── Override cohort (surfaced as its own number, not inside tierMix) ──
    if (isOverrideActive(sub, now)) {
      overrideCount++;
    }

    // ── MRR / trialing MRR / bookings buckets ────────────────────────────
    // Active subs contribute to MRR. Annual normalised as priceXof/12 so
    // the monthly-recurring metric is comparable across cycles.
    // `bookings` exposes the raw charge (what accounting actually sees in
    // this period) — annual = full year upfront, monthly = 1 month.
    const priceXof = sub.priceXof ?? 0;
    if (sub.status === "active") {
      const monthlyEquivalent = cycle === "annual" ? Math.round(priceXof / 12) : priceXof;
      addMoney(mrr, tier, monthlyEquivalent);
      addMoney(bookings, tier, priceXof);
      if (cycle === "annual") annualVsMonthly.annual++;
      else annualVsMonthly.monthly++;
    } else if (sub.status === "trialing") {
      // Pipeline: assume the catalog price at conversion time. We store 0
      // on the subscription during trial (see trial enrolment in
      // subscription.service), so we have to fish the price from the
      // plan doc the sub is pinned to.
      if (plan) {
        const expected =
          cycle === "annual" ? Math.round((plan.annualPriceXof ?? 0) / 12) : (plan.priceXof ?? 0);
        addMoney(trialingMRR, tier, expected);
      }
    }

    // ── Tier mix (active + trialing, override orgs excluded) ─────────────
    // Excluding override orgs keeps the tile honest: their effective limits
    // aren't what their tier's catalog says.
    if ((sub.status === "active" || sub.status === "trialing") && !isOverrideActive(sub, now)) {
      const bucket = tierMix[tier] ?? (tierMix[tier] = { count: 0, byVersion: {} });
      bucket.count++;
      if (plan) {
        bucket.byVersion[plan.version ?? 1] = (bucket.byVersion[plan.version ?? 1] ?? 0) + 1;
      }
    }

    // ── Trial ending in next 7 days ──────────────────────────────────────
    if (sub.status === "trialing" && sub.currentPeriodEnd) {
      const end = new Date(sub.currentPeriodEnd);
      if (end.getTime() > now.getTime() && end.getTime() <= trialWindowEnd.getTime()) {
        const org = orgsById.get(sub.organizationId);
        trialsEndingSoon.push({
          orgId: sub.organizationId,
          orgName: org?.name ?? sub.organizationId,
          tier,
          trialEndAt: sub.currentPeriodEnd,
        });
      }
    }
  }

  trialsEndingSoon.sort(
    (a, b) => new Date(a.trialEndAt).getTime() - new Date(b.trialEndAt).getTime(),
  );

  // ── Near-limit orgs ─────────────────────────────────────────────────────
  // Iterate org docs directly — the effective limits + member count are
  // already denormalised. We don't include maxParticipantsPerEvent
  // (would require a per-event scan; out of scope until there's a
  // `usage` subcollection).
  const nearLimitOrgs: PlanAnalyticsNearLimit[] = [];
  for (const org of organizations) {
    const limits = org.effectiveLimits;
    if (!limits) continue;
    const tier = org.effectivePlanKey ?? org.plan;

    // Members: easy to compute — length of the denormalised array.
    const memberCount = org.memberIds?.length ?? 0;
    const memberLimit = limits.maxMembers;
    if (memberLimit !== PLAN_LIMIT_UNLIMITED && memberLimit > 0) {
      const pct = memberCount / memberLimit;
      if (pct >= NEAR_LIMIT_THRESHOLD) {
        nearLimitOrgs.push({
          orgId: org.id,
          orgName: org.name,
          tier,
          resource: "members",
          current: memberCount,
          limit: memberLimit,
          pct: Math.round(pct * 100),
        });
      }
    }

    // Events: we don't denormalise `activeEventCount` onto the org doc
    // today, so the service-layer wrapper runs those counts in parallel
    // and passes them in via `activeEventsByOrgId`.
    const activeEvents = input.activeEventsByOrgId?.get(org.id) ?? 0;
    const eventLimit = limits.maxEvents;
    if (eventLimit !== PLAN_LIMIT_UNLIMITED && eventLimit > 0) {
      const pct = activeEvents / eventLimit;
      if (pct >= NEAR_LIMIT_THRESHOLD) {
        nearLimitOrgs.push({
          orgId: org.id,
          orgName: org.name,
          tier,
          resource: "events",
          current: activeEvents,
          limit: eventLimit,
          pct: Math.round(pct * 100),
        });
      }
    }
  }

  nearLimitOrgs.sort((a, b) => b.pct - a.pct);

  return {
    computedAt: now.toISOString(),
    mrr,
    trialingMRR,
    bookings,
    tierMix,
    annualVsMonthly,
    overrideCount,
    trialsEndingSoon,
    nearLimitOrgs,
  };
}
