import { describe, it, expect } from "vitest";
import { CreatePlanSchema, PricingModelSchema, PLAN_LIMIT_UNLIMITED } from "../plan.types";

// ─── pricingModel refinement guardrails ─────────────────────────────────────
//
// Pins the cross-field rules on CreatePlanSchema that disambiguate priceXof:
//  - "free"   ⇒ priceXof must be 0
//  - "fixed"  ⇒ priceXof must be > 0
//  - "custom" ⇒ priceXof ignored (any value accepted)
//  - "metered"⇒ priceXof can be 0 (base fee + usage) or > 0

function baseDto() {
  return {
    key: "custom_acme",
    name: { fr: "Plan Acme", en: "Acme Plan" },
    description: null,
    pricingModel: "fixed" as const,
    priceXof: 9900,
    limits: {
      maxEvents: 10,
      maxParticipantsPerEvent: 200,
      maxMembers: 3,
    },
    features: {
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
      promoCodes: false,
    },
    isPublic: true,
    sortOrder: 10,
  };
}

describe("PricingModelSchema", () => {
  it("accepts the four known pricing models", () => {
    for (const model of ["free", "fixed", "custom", "metered"] as const) {
      expect(PricingModelSchema.parse(model)).toBe(model);
    }
  });

  it("rejects unknown pricing models", () => {
    expect(() => PricingModelSchema.parse("trial")).toThrow();
    expect(() => PricingModelSchema.parse("")).toThrow();
  });
});

describe("CreatePlanSchema refinements", () => {
  it("accepts a standard fixed plan", () => {
    const parsed = CreatePlanSchema.safeParse(baseDto());
    expect(parsed.success).toBe(true);
  });

  it("rejects a free plan with priceXof > 0", () => {
    const parsed = CreatePlanSchema.safeParse({
      ...baseDto(),
      pricingModel: "free",
      priceXof: 100,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["priceXof"]);
    }
  });

  it("accepts a free plan with priceXof = 0", () => {
    const parsed = CreatePlanSchema.safeParse({
      ...baseDto(),
      pricingModel: "free",
      priceXof: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a fixed plan with priceXof = 0", () => {
    const parsed = CreatePlanSchema.safeParse({
      ...baseDto(),
      pricingModel: "fixed",
      priceXof: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a custom plan regardless of priceXof (0 or >0)", () => {
    expect(
      CreatePlanSchema.safeParse({
        ...baseDto(),
        pricingModel: "custom",
        priceXof: 0,
      }).success,
    ).toBe(true);

    expect(
      CreatePlanSchema.safeParse({
        ...baseDto(),
        pricingModel: "custom",
        priceXof: 250_000,
      }).success,
    ).toBe(true);
  });

  it("accepts a metered plan with priceXof = 0 (no base fee)", () => {
    const parsed = CreatePlanSchema.safeParse({
      ...baseDto(),
      pricingModel: "metered",
      priceXof: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it("defaults pricingModel to 'fixed' when not provided", () => {
    const { pricingModel: _ignored, ...dtoWithoutModel } = baseDto();
    void _ignored;
    const parsed = CreatePlanSchema.safeParse(dtoWithoutModel);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pricingModel).toBe("fixed");
    }
  });
});

describe("PlanLimitsValueSchema — unlimited marker", () => {
  it("keeps using -1 as the unlimited sentinel", () => {
    expect(PLAN_LIMIT_UNLIMITED).toBe(-1);
    const parsed = CreatePlanSchema.safeParse({
      ...baseDto(),
      pricingModel: "custom",
      priceXof: 0,
      limits: {
        maxEvents: PLAN_LIMIT_UNLIMITED,
        maxParticipantsPerEvent: PLAN_LIMIT_UNLIMITED,
        maxMembers: PLAN_LIMIT_UNLIMITED,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects negative limit values other than -1", () => {
    const parsed = CreatePlanSchema.safeParse({
      ...baseDto(),
      limits: { ...baseDto().limits, maxEvents: -5 },
    });
    expect(parsed.success).toBe(false);
  });
});
