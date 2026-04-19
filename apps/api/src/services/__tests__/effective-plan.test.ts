import { describe, it, expect } from "vitest";
import { resolveEffective, toStoredSnapshot, fromStoredSnapshot } from "../effective-plan";
import {
  type Plan,
  type PlanFeatures,
  type SubscriptionOverrides,
  PLAN_LIMIT_UNLIMITED,
} from "@teranga/shared-types";

// ─── Test builders ─────────────────────────────────────────────────────────

function features(overrides: Partial<PlanFeatures> = {}): PlanFeatures {
  return {
    qrScanning: true,
    paidTickets: false,
    customBadges: true,
    csvExport: true,
    smsNotifications: false,
    advancedAnalytics: false,
    speakerPortal: false,
    sponsorPortal: false,
    apiAccess: false,
    whiteLabel: false,
    promoCodes: true,
    ...overrides,
  };
}

function buildPlan(overrides: Partial<Plan> = {}): Plan {
  const now = new Date().toISOString();
  return {
    id: "plan-starter",
    key: "starter",
    name: { fr: "Starter", en: "Starter" },
    description: null,
    pricingModel: "fixed",
    priceXof: 9900,
    currency: "XOF",
    limits: { maxEvents: 10, maxParticipantsPerEvent: 200, maxMembers: 3 },
    features: features(),
    isSystem: true,
    isPublic: true,
    isArchived: false,
    sortOrder: 1,
    version: 1,
    lineageId: "lin-starter-system",
    isLatest: true,
    previousVersionId: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── resolveEffective: base plan (no overrides) ────────────────────────────

describe("resolveEffective — plan only (no overrides)", () => {
  it("returns the base plan's limits/features verbatim", () => {
    const plan = buildPlan();
    const effective = resolveEffective(plan);

    expect(effective.planKey).toBe("starter");
    expect(effective.planId).toBe("plan-starter");
    expect(effective.limits.maxEvents).toBe(10);
    expect(effective.limits.maxMembers).toBe(3);
    expect(effective.features.qrScanning).toBe(true);
    expect(effective.priceXof).toBe(9900);
  });

  it("translates the stored unlimited marker (-1) to runtime Infinity", () => {
    const plan = buildPlan({
      limits: {
        maxEvents: PLAN_LIMIT_UNLIMITED,
        maxParticipantsPerEvent: PLAN_LIMIT_UNLIMITED,
        maxMembers: PLAN_LIMIT_UNLIMITED,
      },
    });
    const effective = resolveEffective(plan);

    expect(effective.limits.maxEvents).toBe(Infinity);
    expect(effective.limits.maxParticipantsPerEvent).toBe(Infinity);
    expect(effective.limits.maxMembers).toBe(Infinity);
  });
});

// ─── resolveEffective: with active overrides ───────────────────────────────

describe("resolveEffective — active overrides", () => {
  it("applies a limits override on top of the base plan", () => {
    const plan = buildPlan();
    const overrides: SubscriptionOverrides = {
      limits: { maxEvents: 999 },
    };
    const effective = resolveEffective(plan, overrides);

    expect(effective.limits.maxEvents).toBe(999);
    // Unaffected limits fall back to the base plan
    expect(effective.limits.maxMembers).toBe(3);
    expect(effective.limits.maxParticipantsPerEvent).toBe(200);
  });

  it("applies a partial features override", () => {
    const plan = buildPlan();
    const overrides: SubscriptionOverrides = {
      features: { smsNotifications: true, advancedAnalytics: true },
    };
    const effective = resolveEffective(plan, overrides);

    expect(effective.features.smsNotifications).toBe(true);
    expect(effective.features.advancedAnalytics).toBe(true);
    expect(effective.features.qrScanning).toBe(true); // base plan preserved
  });

  it("applies a priceXof override", () => {
    const plan = buildPlan();
    const overrides: SubscriptionOverrides = { priceXof: 1 };
    const effective = resolveEffective(plan, overrides);
    expect(effective.priceXof).toBe(1);
  });

  it("overrides with unlimited marker unpack to Infinity", () => {
    const plan = buildPlan();
    const overrides: SubscriptionOverrides = {
      limits: { maxMembers: PLAN_LIMIT_UNLIMITED },
    };
    const effective = resolveEffective(plan, overrides);
    expect(effective.limits.maxMembers).toBe(Infinity);
  });
});

// ─── resolveEffective: override expiry (validUntil) ────────────────────────

describe("resolveEffective — expired overrides (validUntil)", () => {
  const plan = buildPlan();

  it("ignores overrides when validUntil is in the past", () => {
    const overrides: SubscriptionOverrides = {
      limits: { maxEvents: 999 },
      priceXof: 1,
      validUntil: "2020-01-01T00:00:00.000Z",
    };
    const effective = resolveEffective(plan, overrides, new Date("2026-01-01T00:00:00.000Z"));

    expect(effective.limits.maxEvents).toBe(10); // back to base
    expect(effective.priceXof).toBe(9900); // back to base
  });

  it("applies overrides when validUntil is in the future", () => {
    const overrides: SubscriptionOverrides = {
      limits: { maxEvents: 999 },
      validUntil: "2099-01-01T00:00:00.000Z",
    };
    const effective = resolveEffective(plan, overrides, new Date("2026-01-01T00:00:00.000Z"));

    expect(effective.limits.maxEvents).toBe(999);
  });

  it("applies overrides when validUntil is absent (treated as indefinite)", () => {
    const overrides: SubscriptionOverrides = {
      limits: { maxEvents: 999 },
    };
    const effective = resolveEffective(plan, overrides);
    expect(effective.limits.maxEvents).toBe(999);
  });
});

// ─── Storage round-trip ────────────────────────────────────────────────────

describe("toStoredSnapshot / fromStoredSnapshot round-trip", () => {
  it("converts Infinity → -1 on store and back on read", () => {
    const plan = buildPlan({
      limits: {
        maxEvents: PLAN_LIMIT_UNLIMITED,
        maxParticipantsPerEvent: 500,
        maxMembers: PLAN_LIMIT_UNLIMITED,
      },
    });
    const effective = resolveEffective(plan);
    expect(effective.limits.maxEvents).toBe(Infinity);

    const stored = toStoredSnapshot(effective);
    expect(stored.limits.maxEvents).toBe(PLAN_LIMIT_UNLIMITED);
    expect(stored.limits.maxParticipantsPerEvent).toBe(500);

    const runtime = fromStoredSnapshot(stored);
    expect(runtime.limits.maxEvents).toBe(Infinity);
    expect(runtime.limits.maxParticipantsPerEvent).toBe(500);
    expect(runtime.planKey).toBe("starter");
  });
});
