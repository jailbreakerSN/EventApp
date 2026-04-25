import { describe, it, expect } from "vitest";
import {
  BooleanEntitlementSchema,
  QuotaEntitlementSchema,
  TieredEntitlementSchema,
  EntitlementSchema,
  EntitlementKeySchema,
  EntitlementMapSchema,
  LEGACY_FEATURE_ENTITLEMENT_KEYS,
  LEGACY_QUOTA_ENTITLEMENT_KEYS,
  PLAN_LIMIT_UNLIMITED,
} from "../plan.types";

// ─── Phase 7+ item #2 — Entitlement primitive contract tests ──────────────
//
// These tests pin the boundary contract of the unified entitlement model:
//   - Every kind (boolean / quota / tiered) round-trips through Zod.
//   - Malformed shapes are rejected at the schema boundary so a typo
//     never reaches the resolver.
//   - The legacy key constants match what the resolver projects; a
//     rename here would drift the back-compat contract, so pinning the
//     values explicitly catches that class of regression.
//
// Keep these tests independent of the resolver — they validate the
// data shape only.

describe("EntitlementSchema — kind-level validation", () => {
  it("accepts a boolean entitlement", () => {
    const parsed = EntitlementSchema.parse({ kind: "boolean", value: true });
    expect(parsed.kind).toBe("boolean");
    expect(parsed.kind === "boolean" && parsed.value).toBe(true);
  });

  it("accepts a quota entitlement with monthly period + overage rate", () => {
    const parsed = QuotaEntitlementSchema.parse({
      kind: "quota",
      limit: 500,
      period: "month",
      overageRateXof: 25,
    });
    expect(parsed.limit).toBe(500);
    expect(parsed.period).toBe("month");
    expect(parsed.overageRateXof).toBe(25);
  });

  it("accepts quota limit = -1 (unlimited) with the same convention as PlanLimits", () => {
    // This is the back-compat anchor: the resolver's storedToRuntime
    // helper routes -1 → Infinity for both legacy limits and quota
    // entitlements uniformly. If the schema starts rejecting -1 here,
    // every unlimited quota breaks silently on persist.
    const parsed = QuotaEntitlementSchema.parse({
      kind: "quota",
      limit: PLAN_LIMIT_UNLIMITED,
      period: "cycle",
    });
    expect(parsed.limit).toBe(-1);
  });

  it("rejects quota limits < -1", () => {
    expect(() =>
      QuotaEntitlementSchema.parse({ kind: "quota", limit: -42, period: "month" }),
    ).toThrow();
  });

  it("accepts a tiered entitlement (schema-reserved for metered billing)", () => {
    const parsed = TieredEntitlementSchema.parse({
      kind: "tiered",
      tiers: [
        { upTo: 100, unitPriceXof: 0 },
        { upTo: 1000, unitPriceXof: 25 },
        { upTo: "unlimited", unitPriceXof: 50 },
      ],
    });
    expect(parsed.tiers).toHaveLength(3);
  });

  it("rejects a tiered entitlement with zero tiers", () => {
    expect(() => TieredEntitlementSchema.parse({ kind: "tiered", tiers: [] })).toThrow();
  });

  it("rejects an unknown kind via the discriminated union", () => {
    expect(() =>
      EntitlementSchema.parse({ kind: "percentage", value: 50 }),
    ).toThrow();
  });

  it("rejects a boolean entitlement missing the value field", () => {
    expect(() => BooleanEntitlementSchema.parse({ kind: "boolean" })).toThrow();
  });
});

// ─── Key-shape validation ─────────────────────────────────────────────────

describe("EntitlementKeySchema — namespace guard", () => {
  it("accepts the three prefixes (feature / quota / tiered)", () => {
    expect(EntitlementKeySchema.parse("feature.qrScanning")).toBe("feature.qrScanning");
    expect(EntitlementKeySchema.parse("quota.sms.monthly")).toBe("quota.sms.monthly");
    expect(EntitlementKeySchema.parse("tiered.apiCalls")).toBe("tiered.apiCalls");
  });

  it("rejects keys without a namespace", () => {
    expect(() => EntitlementKeySchema.parse("qrScanning")).toThrow();
  });

  it("rejects unknown namespaces", () => {
    expect(() => EntitlementKeySchema.parse("limit.events")).toThrow();
  });

  it("rejects keys with a dot but no name after the prefix", () => {
    expect(() => EntitlementKeySchema.parse("feature.")).toThrow();
  });
});

describe("EntitlementMapSchema — record validation", () => {
  it("accepts a map with multiple kinds", () => {
    const parsed = EntitlementMapSchema.parse({
      "feature.customBadges": { kind: "boolean", value: true },
      "quota.events": { kind: "quota", limit: 10, period: "cycle" },
    });
    expect(Object.keys(parsed)).toHaveLength(2);
  });

  it("rejects a map with a malformed key", () => {
    expect(() =>
      EntitlementMapSchema.parse({
        "bad_key": { kind: "boolean", value: true },
      }),
    ).toThrow();
  });

  it("rejects a map with a malformed value", () => {
    expect(() =>
      EntitlementMapSchema.parse({
        "feature.qrScanning": { kind: "boolean", value: "yes" },
      }),
    ).toThrow();
  });
});

// ─── Legacy key constants — pinning the back-compat contract ──────────────

describe("LEGACY_FEATURE_ENTITLEMENT_KEYS — back-compat contract", () => {
  it("covers every one of the PlanFeatures keys", () => {
    // Any PlanFeatures key that loses its entitlement mapping would
    // silently break the resolver's projection for that feature; pin
    // the exact value set so a rename elsewhere is caught.
    expect(LEGACY_FEATURE_ENTITLEMENT_KEYS).toEqual({
      qrScanning: "feature.qrScanning",
      paidTickets: "feature.paidTickets",
      customBadges: "feature.customBadges",
      csvExport: "feature.csvExport",
      smsNotifications: "feature.smsNotifications",
      advancedAnalytics: "feature.advancedAnalytics",
      speakerPortal: "feature.speakerPortal",
      sponsorPortal: "feature.sponsorPortal",
      apiAccess: "feature.apiAccess",
      whiteLabel: "feature.whiteLabel",
      promoCodes: "feature.promoCodes",
      // B2 follow-up — waitlist gating added in the same commit set
      // that introduced the smart-promotion service surface.
      waitlist: "feature.waitlist",
    });
  });

  it("every mapped value passes EntitlementKeySchema", () => {
    // Make sure none of the constants can drift into an invalid shape.
    for (const key of Object.values(LEGACY_FEATURE_ENTITLEMENT_KEYS)) {
      expect(() => EntitlementKeySchema.parse(key)).not.toThrow();
    }
  });
});

describe("LEGACY_QUOTA_ENTITLEMENT_KEYS — back-compat contract", () => {
  it("covers every one of the 3 PlanLimits keys", () => {
    expect(LEGACY_QUOTA_ENTITLEMENT_KEYS).toEqual({
      maxEvents: "quota.events",
      maxParticipantsPerEvent: "quota.participantsPerEvent",
      maxMembers: "quota.members",
    });
  });

  it("every mapped value passes EntitlementKeySchema", () => {
    for (const key of Object.values(LEGACY_QUOTA_ENTITLEMENT_KEYS)) {
      expect(() => EntitlementKeySchema.parse(key)).not.toThrow();
    }
  });
});
