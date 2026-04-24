import { describe, it, expect } from "vitest";
import {
  CreatePlanCouponSchema,
  PlanCouponCodeSchema,
  computeCouponDiscount,
} from "../plan-coupon.types";

describe("PlanCouponCodeSchema", () => {
  it("accepts uppercase alphanumeric codes with underscore / hyphen", () => {
    expect(PlanCouponCodeSchema.safeParse("LAUNCH2026").success).toBe(true);
    expect(PlanCouponCodeSchema.safeParse("TERANGA_PARTNER-01").success).toBe(true);
  });

  it("rejects lowercase, too-short, too-long, and special chars", () => {
    expect(PlanCouponCodeSchema.safeParse("launch").success).toBe(false);
    expect(PlanCouponCodeSchema.safeParse("AB").success).toBe(false);
    expect(PlanCouponCodeSchema.safeParse("A".repeat(51)).success).toBe(false);
    expect(PlanCouponCodeSchema.safeParse("HELLO!").success).toBe(false);
  });
});

describe("CreatePlanCouponSchema refinements", () => {
  const base = {
    code: "TEST2026",
    discountType: "percentage" as const,
    discountValue: 25,
  };

  it("accepts a valid percentage coupon", () => {
    expect(CreatePlanCouponSchema.safeParse(base).success).toBe(true);
  });

  it("rejects percentage > 100", () => {
    const r = CreatePlanCouponSchema.safeParse({ ...base, discountValue: 150 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toContain("discountValue");
    }
  });

  it("accepts a valid fixed coupon over 100 (XOF amount)", () => {
    const r = CreatePlanCouponSchema.safeParse({
      ...base,
      discountType: "fixed",
      discountValue: 5000,
    });
    expect(r.success).toBe(true);
  });

  it("rejects startsAt >= expiresAt", () => {
    const r = CreatePlanCouponSchema.safeParse({
      ...base,
      startsAt: "2026-05-01T00:00:00.000Z",
      expiresAt: "2026-04-01T00:00:00.000Z",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toContain("expiresAt");
    }
  });

  it("accepts startsAt < expiresAt", () => {
    const r = CreatePlanCouponSchema.safeParse({
      ...base,
      startsAt: "2026-04-01T00:00:00.000Z",
      expiresAt: "2026-05-01T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });
});

describe("computeCouponDiscount", () => {
  it("floors percentage discounts to integer XOF", () => {
    // 25% of 9 900 = 2 475 (exact integer)
    expect(computeCouponDiscount(9_900, "percentage", 25)).toEqual({
      discountXof: 2_475,
      finalPriceXof: 7_425,
    });
  });

  it("floors percentage discounts that would otherwise be fractional", () => {
    // 33% of 9 900 = 3267 (integer), 33% of 100 = 33 (floor)
    expect(computeCouponDiscount(100, "percentage", 33)).toEqual({
      discountXof: 33,
      finalPriceXof: 67,
    });
    // 37% of 1001 = 370.37 → floored to 370
    expect(computeCouponDiscount(1001, "percentage", 37)).toEqual({
      discountXof: 370,
      finalPriceXof: 631,
    });
  });

  it("applies fixed discounts as the full XOF amount", () => {
    expect(computeCouponDiscount(29_900, "fixed", 5000)).toEqual({
      discountXof: 5000,
      finalPriceXof: 24_900,
    });
  });

  it("caps fixed discount at originalPriceXof (never goes negative)", () => {
    expect(computeCouponDiscount(10_000, "fixed", 50_000)).toEqual({
      discountXof: 10_000,
      finalPriceXof: 0,
    });
  });

  it("handles priceXof === 0 without division issues", () => {
    expect(computeCouponDiscount(0, "percentage", 50)).toEqual({
      discountXof: 0,
      finalPriceXof: 0,
    });
  });

  it("100% percentage wipes the price", () => {
    expect(computeCouponDiscount(29_900, "percentage", 100)).toEqual({
      discountXof: 29_900,
      finalPriceXof: 0,
    });
  });
});
