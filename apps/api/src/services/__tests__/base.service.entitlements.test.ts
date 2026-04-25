import { describe, it, expect } from "vitest";
import {
  type Organization,
  PLAN_LIMIT_UNLIMITED,
  LEGACY_FEATURE_ENTITLEMENT_KEYS,
  LEGACY_QUOTA_ENTITLEMENT_KEYS,
} from "@teranga/shared-types";
import { BaseService } from "../base.service";
import { PlanLimitError } from "@/errors/app-error";

// ─── Phase 7+ item #2 — BaseService entitlement helpers ────────────────────
//
// The unified entitlement model ships two new enforcement helpers alongside
// the existing `requirePlanFeature` / `checkPlanLimit`:
//
//   - requireEntitlement(org, key)  → throws PlanLimitError if missing
//   - checkQuota(org, key, current) → non-throwing quota probe
//
// Contract we pin here:
//   1. When `org.effectiveEntitlements` covers the key, the helpers read
//      from that map.
//   2. When the field is absent OR the key is absent from the map, the
//      helpers fall back to the legacy `org.effectiveFeatures` /
//      `effectiveLimits` for the 14 known legacy keys.
//   3. For unknown keys with no entitlement present, helpers deny by
//      default — a capability we know nothing about MUST NOT be granted
//      silently.

// Expose protected helpers via a tiny concrete subclass so we can unit-test
// them without dragging in any concrete service's Firestore deps.
class TestService extends BaseService {
  public callRequireEntitlement(org: Organization, key: string): void {
    return this.requireEntitlement(org, key);
  }
  public callCheckQuota(org: Organization, key: string, current: number) {
    return this.checkQuota(org, key, current);
  }
  public callRequirePlanFeature(
    org: Organization,
    feature: Parameters<BaseService["requirePlanFeature"]>[1],
  ): void {
    return this.requirePlanFeature(org, feature);
  }
}

const service = new TestService();

function buildOrg(patch: Partial<Organization> = {}): Organization {
  const now = new Date().toISOString();
  return {
    id: "org-1",
    name: "Teranga Events",
    slug: "teranga",
    plan: "pro",
    isVerified: true,
    isActive: true,
    memberIds: ["u-1"],
    country: "SN",
    createdAt: now,
    updatedAt: now,
    effectiveLimits: {
      maxEvents: 50,
      maxParticipantsPerEvent: 1000,
      maxMembers: 10,
    },
    effectiveFeatures: {
      qrScanning: true,
      paidTickets: true,
      customBadges: true,
      csvExport: true,
      smsNotifications: false,
      advancedAnalytics: true,
      speakerPortal: true,
      sponsorPortal: true,
      apiAccess: false,
      whiteLabel: false,
      promoCodes: true,
    },
    effectivePlanKey: "pro",
    effectiveComputedAt: now,
    ...patch,
  } as Organization;
}

// ─── requireEntitlement ─────────────────────────────────────────────────────

describe("BaseService.requireEntitlement — entitlement map wins when present", () => {
  it("grants a boolean entitlement when kind=boolean value=true", () => {
    const org = buildOrg({
      effectiveEntitlements: {
        "feature.smsNotifications": { kind: "boolean", value: true },
      },
    });
    // No throw — the helper finds the entitlement and lets the caller
    // through even though legacy `effectiveFeatures.smsNotifications` is
    // false. The entitlement map is authoritative.
    expect(() =>
      service.callRequireEntitlement(org, "feature.smsNotifications"),
    ).not.toThrow();
  });

  it("denies a boolean entitlement when value=false", () => {
    const org = buildOrg({
      effectiveEntitlements: {
        "feature.customBadges": { kind: "boolean", value: false },
      },
    });
    // Denies even though legacy `effectiveFeatures.customBadges` is true.
    expect(() => service.callRequireEntitlement(org, "feature.customBadges")).toThrow(
      PlanLimitError,
    );
  });

  it("denies an exhausted quota entitlement (limit === 0)", () => {
    const org = buildOrg({
      effectiveEntitlements: {
        "quota.sms.monthly": { kind: "quota", limit: 0, period: "month" },
      },
    });
    expect(() => service.callRequireEntitlement(org, "quota.sms.monthly")).toThrow(
      PlanLimitError,
    );
  });

  it("grants an unlimited quota entitlement (limit === -1)", () => {
    const org = buildOrg({
      effectiveEntitlements: {
        "quota.sms.monthly": {
          kind: "quota",
          limit: PLAN_LIMIT_UNLIMITED,
          period: "month",
        },
      },
    });
    expect(() =>
      service.callRequireEntitlement(org, "quota.sms.monthly"),
    ).not.toThrow();
  });
});

describe("BaseService.requireEntitlement — legacy fallback when entitlements absent", () => {
  it("falls back to requirePlanFeature for the 11 legacy boolean keys", () => {
    // Org has no effectiveEntitlements at all — classic legacy org.
    const org = buildOrg({ effectiveEntitlements: undefined });
    expect(() =>
      service.callRequireEntitlement(org, LEGACY_FEATURE_ENTITLEMENT_KEYS.qrScanning),
    ).not.toThrow();
    expect(() =>
      service.callRequireEntitlement(org, LEGACY_FEATURE_ENTITLEMENT_KEYS.smsNotifications),
    ).toThrow(PlanLimitError);
  });

  it("falls back when effectiveEntitlements is set but doesn't cover the key", () => {
    const org = buildOrg({
      effectiveEntitlements: {
        // Only covers one key — the other should still fall back.
        "feature.whiteLabel": { kind: "boolean", value: true },
      },
    });
    expect(() =>
      service.callRequireEntitlement(org, LEGACY_FEATURE_ENTITLEMENT_KEYS.qrScanning),
    ).not.toThrow();
  });

  it("denies an unknown key with no legacy mapping and no entitlement", () => {
    const org = buildOrg({ effectiveEntitlements: {} });
    expect(() =>
      service.callRequireEntitlement(org, "feature.futureCapability"),
    ).toThrow(PlanLimitError);
  });
});

// ─── checkQuota ─────────────────────────────────────────────────────────────

describe("BaseService.checkQuota — entitlement map wins when present", () => {
  it("reports a quota entitlement's limit runtime-unpacked (-1 → Infinity)", () => {
    const org = buildOrg({
      effectiveEntitlements: {
        "quota.events": {
          kind: "quota",
          limit: PLAN_LIMIT_UNLIMITED,
          period: "cycle",
        },
      },
    });
    const result = service.callCheckQuota(org, "quota.events", 99999);
    expect(result.limit).toBe(Infinity);
    expect(result.allowed).toBe(true);
  });

  it("returns allowed=false when current meets the quota limit", () => {
    const org = buildOrg({
      effectiveEntitlements: {
        "quota.members": { kind: "quota", limit: 5, period: "cycle" },
      },
    });
    const result = service.callCheckQuota(org, "quota.members", 5);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(5);
    expect(result.current).toBe(5);
  });

  it("denies when the entitlement is present but the wrong kind", () => {
    // Plan misconfiguration: a key declared as `boolean` when caller
    // expects a quota. Loudly deny rather than pass silently.
    const org = buildOrg({
      effectiveEntitlements: {
        "quota.sms.monthly": { kind: "boolean", value: true },
      },
    });
    const result = service.callCheckQuota(org, "quota.sms.monthly", 0);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
  });
});

describe("BaseService.checkQuota — legacy fallback when entitlements absent", () => {
  it("falls back to checkPlanLimit for the 3 legacy quota keys", () => {
    const org = buildOrg({ effectiveEntitlements: undefined });
    const result = service.callCheckQuota(
      org,
      LEGACY_QUOTA_ENTITLEMENT_KEYS.maxEvents,
      49,
    );
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(50);
  });

  it("returns allowed=false for unknown keys with no fallback", () => {
    const org = buildOrg({ effectiveEntitlements: {} });
    const result = service.callCheckQuota(org, "quota.api.dailyRequests", 0);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
  });
});

// ─── Back-compat regression ─────────────────────────────────────────────────

describe("BaseService — tiered entitlement denies until resolver lands (B5)", () => {
  it("requireEntitlement on a tiered entitlement DENIES (band resolver not shipped yet)", () => {
    // Review blocker B5: without this guard, a super-admin who typed
    // `{"tiered.apiCalls":{kind:"tiered",tiers:[...]}}` in the plan
    // JSON editor would grant unlimited access via requireEntitlement
    // because isEntitlementActive used to return `true` for tiered
    // kinds. The resolver that reads tier bands + per-tenant counters
    // lands with the first real metered plan; until then, DENY.
    const org = buildOrg({
      effectiveEntitlements: {
        "tiered.apiCalls": {
          kind: "tiered",
          tiers: [{ upTo: 100, unitPriceXof: 0 }],
        },
      },
    });
    expect(() => service.callRequireEntitlement(org, "tiered.apiCalls")).toThrow(
      PlanLimitError,
    );
  });

  it("checkQuota on a tiered entitlement also denies (symmetry with requireEntitlement)", () => {
    const org = buildOrg({
      effectiveEntitlements: {
        "tiered.apiCalls": {
          kind: "tiered",
          tiers: [{ upTo: 100, unitPriceXof: 0 }],
        },
      },
    });
    const result = service.callCheckQuota(org, "tiered.apiCalls", 0);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
  });
});

describe("BaseService — legacy helpers still work unchanged", () => {
  it("requirePlanFeature still reads effectiveFeatures regardless of the entitlement map", () => {
    // Adding effectiveEntitlements must NOT change the 14 existing call
    // sites that use requirePlanFeature / checkPlanLimit. Pin that.
    const org = buildOrg({
      effectiveFeatures: {
        ...buildOrg().effectiveFeatures!,
        smsNotifications: false,
      },
      effectiveEntitlements: {
        // Entitlements say YES, but the LEGACY path (requirePlanFeature)
        // must still read effectiveFeatures, which says NO.
        "feature.smsNotifications": { kind: "boolean", value: true },
      },
    });
    expect(() => service.callRequirePlanFeature(org, "smsNotifications")).toThrow(
      PlanLimitError,
    );
  });
});

// ─── hasPlanFeature (B2 follow-up — non-throwing variant) ─────────────────
// The waitlist gate in registration.service.register() needs to branch on
// the feature flag without catching `PlanLimitError` (its rejection path
// is `EventFullError`, not the plan-limit family). `hasPlanFeature` is
// the non-throwing read that supports that.

class HasFeatureService extends BaseService {
  public callHasPlanFeature(
    org: Organization,
    feature: Parameters<BaseService["requirePlanFeature"]>[1],
  ): boolean {
    return this.hasPlanFeature(org, feature);
  }
}
const hasFeatureService = new HasFeatureService();

describe("BaseService.hasPlanFeature", () => {
  it("returns true when effectiveFeatures has the flag set", () => {
    const org = buildOrg();
    expect(hasFeatureService.callHasPlanFeature(org, "qrScanning")).toBe(true);
  });

  it("returns false when effectiveFeatures has the flag explicitly off", () => {
    const org = buildOrg({
      effectiveFeatures: {
        ...buildOrg().effectiveFeatures!,
        smsNotifications: false,
      },
    });
    expect(hasFeatureService.callHasPlanFeature(org, "smsNotifications")).toBe(false);
  });

  it("returns false when the flag is undefined (legacy / pre-denorm orgs)", () => {
    // The new `waitlist` flag was added after denorm shipped; legacy
    // orgs that haven't been re-projected won't have it. The helper
    // must treat `undefined` as `false` (the safe default that matches
    // the free-tier value) — surfacing an undefined as "permitted"
    // would silently regress the gate to free-tier orgs.
    const baseFeatures = buildOrg().effectiveFeatures!;
    const features = { ...baseFeatures };
    delete (features as Record<string, unknown>).waitlist;
    const org = buildOrg({ effectiveFeatures: features });
    expect(hasFeatureService.callHasPlanFeature(org, "waitlist")).toBe(false);
  });

  it("falls back to PLAN_LIMITS[org.plan] when effectiveFeatures is missing", () => {
    // Pre-denorm orgs have `org.effectiveFeatures` undefined; the
    // resolver falls back to the static PLAN_LIMITS table. Pro plan
    // includes waitlist=true so the read should be true.
    const org = buildOrg({ plan: "pro", effectiveFeatures: undefined });
    expect(hasFeatureService.callHasPlanFeature(org, "waitlist")).toBe(true);
  });

  it("free plan correctly reports waitlist=false in the legacy fallback", () => {
    const org = buildOrg({ plan: "free", effectiveFeatures: undefined });
    expect(hasFeatureService.callHasPlanFeature(org, "waitlist")).toBe(false);
  });
});
