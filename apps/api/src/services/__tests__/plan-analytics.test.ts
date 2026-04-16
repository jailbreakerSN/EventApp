import { describe, it, expect } from "vitest";
import type { Organization, Plan, Subscription } from "@teranga/shared-types";
import { PLAN_LIMIT_UNLIMITED } from "@teranga/shared-types";
import { computePlanAnalytics } from "../plan-analytics";

// ─── Builders (keep tests readable) ──────────────────────────────────────────

function plan(overrides: Partial<Plan>): Plan {
  return {
    id: overrides.id ?? "pro-v1",
    key: overrides.key ?? "pro",
    version: 1,
    lineageId: "lin-pro",
    isLatest: true,
    previousVersionId: null,
    name: { fr: "Pro", en: "Pro" },
    description: null,
    pricingModel: "fixed",
    priceXof: 29_900,
    annualPriceXof: 287_040,
    currency: "XOF",
    limits: { maxEvents: 10, maxParticipantsPerEvent: 2000, maxMembers: 50 },
    features: {
      qrScanning: true,
      paidTickets: true,
      customBadges: true,
      csvExport: true,
      smsNotifications: true,
      advancedAnalytics: true,
      speakerPortal: true,
      sponsorPortal: true,
      apiAccess: false,
      whiteLabel: false,
      promoCodes: true,
    },
    isSystem: true,
    isPublic: true,
    isArchived: false,
    sortOrder: 2,
    trialDays: 14,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Plan;
}

function sub(overrides: Partial<Subscription>): Subscription {
  return {
    id: overrides.id ?? "sub-1",
    organizationId: overrides.organizationId ?? "org-1",
    plan: "pro",
    planId: "pro-v1",
    status: "active",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    cancelledAt: null,
    paymentMethod: null,
    priceXof: 29_900,
    billingCycle: "monthly",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Subscription;
}

function org(overrides: Partial<Organization>): Organization {
  return {
    id: overrides.id ?? "org-1",
    name: overrides.name ?? "Acme",
    slug: overrides.name?.toLowerCase() ?? "acme",
    logoURL: null,
    coverURL: null,
    website: null,
    description: null,
    country: "SN",
    city: null,
    phone: null,
    email: null,
    plan: "pro",
    ownerId: "owner",
    memberIds: [],
    isVerified: false,
    isActive: true,
    effectiveLimits: {
      maxEvents: 10,
      maxParticipantsPerEvent: 2000,
      maxMembers: 50,
    },
    effectiveFeatures: {
      qrScanning: true,
      paidTickets: true,
      customBadges: true,
      csvExport: true,
      smsNotifications: true,
      advancedAnalytics: true,
      speakerPortal: true,
      sponsorPortal: true,
      apiAccess: false,
      whiteLabel: false,
      promoCodes: true,
    },
    effectivePlanKey: "pro",
    effectiveComputedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Organization;
}

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("computePlanAnalytics — MRR fold (Phase 7+ item #5)", () => {
  it("normalises annual subs as priceXof/12 for MRR; keeps raw priceXof in bookings", () => {
    const result = computePlanAnalytics({
      now: NOW,
      plans: [plan({ id: "pro-v1", key: "pro", annualPriceXof: 287_040 })],
      organizations: [org({ id: "org-annual" })],
      subscriptions: [
        sub({
          id: "sub-annual",
          organizationId: "org-annual",
          plan: "pro",
          planId: "pro-v1",
          status: "active",
          billingCycle: "annual",
          priceXof: 287_040,
        }),
      ],
    });

    // 287 040 / 12 = 23 920 monthly-equivalent
    expect(result.mrr.total).toBe(23_920);
    expect(result.mrr.byTier.pro).toBe(23_920);
    // Raw cash recognised this period
    expect(result.bookings.total).toBe(287_040);
    expect(result.annualVsMonthly).toEqual({ monthly: 0, annual: 1 });
  });

  it("excludes trialing / past_due / cancelled from MRR; exposes trialingMRR as pipeline", () => {
    const result = computePlanAnalytics({
      now: NOW,
      plans: [plan({ id: "pro-v1", key: "pro", priceXof: 29_900 })],
      organizations: [
        org({ id: "org-active" }),
        org({ id: "org-trial" }),
        org({ id: "org-cancelled" }),
        org({ id: "org-pastdue" }),
      ],
      subscriptions: [
        sub({ id: "sub-active", organizationId: "org-active", status: "active" }),
        sub({
          id: "sub-trial",
          organizationId: "org-trial",
          status: "trialing",
          priceXof: 0, // trial price suspended
          currentPeriodEnd: "2026-06-20T00:00:00.000Z",
        }),
        sub({ id: "sub-cancelled", organizationId: "org-cancelled", status: "cancelled" }),
        sub({ id: "sub-pastdue", organizationId: "org-pastdue", status: "past_due" }),
      ],
    });

    // Only the active sub contributes to MRR.
    expect(result.mrr.total).toBe(29_900);
    // Trialing sub's expected conversion price shows up in pipeline.
    expect(result.trialingMRR.total).toBe(29_900);
    expect(result.trialingMRR.byTier.pro).toBe(29_900);
  });

  it("groups tier mix by version + excludes orgs with active overrides", () => {
    const result = computePlanAnalytics({
      now: NOW,
      plans: [
        plan({ id: "pro-v1", key: "pro", version: 1 }),
        plan({ id: "pro-v2", key: "pro", version: 2, isLatest: true }),
      ],
      organizations: [
        org({ id: "org-v1-a" }),
        org({ id: "org-v1-b" }),
        org({ id: "org-v2" }),
        org({ id: "org-override" }),
      ],
      subscriptions: [
        sub({ id: "s1", organizationId: "org-v1-a", planId: "pro-v1" }),
        sub({ id: "s2", organizationId: "org-v1-b", planId: "pro-v1" }),
        sub({ id: "s3", organizationId: "org-v2", planId: "pro-v2" }),
        // Override org — valid until next year, so counts in overrideCount,
        // NOT in tierMix (would skew the snapshot).
        sub({
          id: "s4",
          organizationId: "org-override",
          planId: "pro-v2",
          overrides: { limits: { maxMembers: 100 }, validUntil: "2027-01-01T00:00:00.000Z" },
        }),
      ],
    });

    expect(result.tierMix.pro.count).toBe(3); // override excluded
    expect(result.tierMix.pro.byVersion).toEqual({ 1: 2, 2: 1 });
    expect(result.overrideCount).toBe(1);
  });

  it("expired overrides are not counted (validUntil in the past)", () => {
    const result = computePlanAnalytics({
      now: NOW,
      plans: [plan({ id: "pro-v1" })],
      organizations: [org({ id: "org-1" })],
      subscriptions: [
        sub({
          organizationId: "org-1",
          overrides: { limits: { maxMembers: 100 }, validUntil: "2026-01-01T00:00:00.000Z" },
        }),
      ],
    });

    expect(result.overrideCount).toBe(0);
    expect(result.tierMix.pro?.count).toBe(1);
  });

  it("surfaces trials ending in the next 7 days, sorted ascending", () => {
    const result = computePlanAnalytics({
      now: NOW,
      plans: [plan({ id: "pro-v1" })],
      organizations: [
        org({ id: "org-far", name: "Future" }),
        org({ id: "org-soon", name: "Soon" }),
        org({ id: "org-very-soon", name: "Very Soon" }),
        org({ id: "org-past", name: "Past" }),
      ],
      subscriptions: [
        sub({
          organizationId: "org-far",
          status: "trialing",
          currentPeriodEnd: "2026-07-01T00:00:00.000Z", // >7d away
        }),
        sub({
          organizationId: "org-soon",
          status: "trialing",
          currentPeriodEnd: "2026-06-20T00:00:00.000Z", // 5d away
        }),
        sub({
          organizationId: "org-very-soon",
          status: "trialing",
          currentPeriodEnd: "2026-06-16T12:00:00.000Z", // 1d away
        }),
        sub({
          organizationId: "org-past",
          status: "trialing",
          currentPeriodEnd: "2026-06-01T00:00:00.000Z", // already ended
        }),
      ],
    });

    // Only the two in the window, sorted by trialEndAt asc.
    expect(result.trialsEndingSoon.map((t) => t.orgName)).toEqual(["Very Soon", "Soon"]);
  });

  it("flags near-limit orgs at ≥80% of maxEvents / maxMembers (not maxParticipantsPerEvent)", () => {
    const result = computePlanAnalytics({
      now: NOW,
      plans: [plan({ id: "pro-v1" })],
      organizations: [
        org({
          id: "org-events",
          name: "At Event Limit",
          effectiveLimits: { maxEvents: 10, maxParticipantsPerEvent: 2000, maxMembers: 50 },
        }),
        org({
          id: "org-members",
          name: "At Member Limit",
          memberIds: ["m1", "m2", "m3", "m4", "m5"], // 5 / 5 = 100%
          effectiveLimits: { maxEvents: 10, maxParticipantsPerEvent: 2000, maxMembers: 5 },
        }),
        org({
          id: "org-safe",
          name: "Well Below",
          effectiveLimits: { maxEvents: 10, maxParticipantsPerEvent: 2000, maxMembers: 50 },
        }),
      ],
      subscriptions: [
        sub({ organizationId: "org-events" }),
        sub({ id: "s-m", organizationId: "org-members" }),
        sub({ id: "s-s", organizationId: "org-safe" }),
      ],
      activeEventsByOrgId: new Map([
        ["org-events", 9], // 9 / 10 = 90% → flagged
        ["org-members", 2],
        ["org-safe", 3],
      ]),
    });

    const names = result.nearLimitOrgs.map((n) => `${n.orgName}:${n.resource}:${n.pct}`);
    // Both near-limit orgs appear, sorted by pct desc.
    expect(names).toContain("At Member Limit:members:100");
    expect(names).toContain("At Event Limit:events:90");
    expect(names[0]).toContain("100"); // highest pct first
    // The safe org is absent.
    expect(names.some((n) => n.startsWith("Well Below"))).toBe(false);
  });

  it("unlimited limits (-1) never trigger near-limit — no division by a sentinel", () => {
    const result = computePlanAnalytics({
      now: NOW,
      plans: [plan({ id: "pro-v1" })],
      organizations: [
        org({
          id: "org-unlimited",
          memberIds: Array(1000)
            .fill("u")
            .map((_, i) => `u${i}`),
          effectiveLimits: {
            maxEvents: PLAN_LIMIT_UNLIMITED,
            maxParticipantsPerEvent: PLAN_LIMIT_UNLIMITED,
            maxMembers: PLAN_LIMIT_UNLIMITED,
          },
        }),
      ],
      subscriptions: [sub({ organizationId: "org-unlimited" })],
      activeEventsByOrgId: new Map([["org-unlimited", 9999]]),
    });

    expect(result.nearLimitOrgs).toEqual([]);
  });

  it("includes computedAt (ISO) so the UI can display freshness", () => {
    const result = computePlanAnalytics({
      now: NOW,
      plans: [],
      organizations: [],
      subscriptions: [],
    });
    expect(result.computedAt).toBe(NOW.toISOString());
  });

  it("empty inputs produce zero aggregates (no div-by-zero, no undefined)", () => {
    const result = computePlanAnalytics({
      now: NOW,
      plans: [],
      organizations: [],
      subscriptions: [],
    });
    expect(result.mrr).toEqual({ total: 0, byTier: {} });
    expect(result.bookings).toEqual({ total: 0, byTier: {} });
    expect(result.trialingMRR).toEqual({ total: 0, byTier: {} });
    expect(result.tierMix).toEqual({});
    expect(result.overrideCount).toBe(0);
    expect(result.trialsEndingSoon).toEqual([]);
    expect(result.nearLimitOrgs).toEqual([]);
  });
});
