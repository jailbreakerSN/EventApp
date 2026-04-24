import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUser, buildSuperAdmin } from "@/__tests__/factories";
import type { Plan, PlanCoupon } from "@teranga/shared-types";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockTxGet = vi.fn();
const mockTxSet = vi.fn();
const mockTxUpdate = vi.fn();

const mockCouponDocRef = { id: "TEST2026" };
const mockRedemptionRef = { id: "redeem-1" };

const mockCouponDoc = { get: vi.fn() };

const mockQuery = {
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  count: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }) }),
  get: vi.fn(),
};

const mockCollection = {
  doc: vi.fn((id?: string) => {
    if (id === undefined) return mockRedemptionRef;
    return { ...mockCouponDocRef, id, get: mockCouponDoc.get };
  }),
  where: vi.fn().mockReturnValue(mockQuery),
  orderBy: vi.fn().mockReturnValue(mockQuery),
};

vi.mock("@/config/firebase", () => ({
  db: {
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { get: mockTxGet, set: mockTxSet, update: mockTxUpdate };
      return fn(tx);
    }),
    collection: vi.fn(() => mockCollection),
  },
  COLLECTIONS: {
    PLAN_COUPONS: "planCoupons",
    COUPON_REDEMPTIONS: "couponRedemptions",
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

vi.mock("@/repositories/plan.repository", () => ({
  planRepository: { findById: vi.fn() },
}));

// Import AFTER mocks
import { planCouponService } from "../plan-coupon.service";

function buildPlan(overrides: Partial<Plan> = {}): Plan {
  const now = new Date().toISOString();
  return {
    id: "plan-pro",
    key: "pro",
    name: { fr: "Pro", en: "Pro" },
    description: null,
    pricingModel: "fixed",
    priceXof: 29_900,
    annualPriceXof: 299_000,
    currency: "XOF",
    limits: { maxEvents: -1, maxParticipantsPerEvent: 2000, maxMembers: 50 },
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
    sortOrder: 1,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Plan;
}

function buildCoupon(overrides: Partial<PlanCoupon> = {}): PlanCoupon {
  const now = new Date().toISOString();
  return {
    id: "TEST2026",
    code: "TEST2026",
    label: "Test coupon",
    discountType: "percentage",
    discountValue: 25,
    appliedPlanIds: null,
    appliedCycles: null,
    maxUses: null,
    maxUsesPerOrg: null,
    usedCount: 0,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    createdBy: "admin-1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.where.mockReturnThis();
  mockQuery.orderBy.mockReturnThis();
  mockQuery.offset.mockReturnThis();
  mockQuery.limit.mockReturnThis();
});

describe("PlanCouponService.create — permission + conflict", () => {
  const participant = buildAuthUser({ roles: ["participant"] });
  const admin = buildSuperAdmin();

  it("rejects non-super_admin callers", async () => {
    await expect(
      planCouponService.create(
        { code: "TEST2026", discountType: "percentage", discountValue: 25 },
        participant,
      ),
    ).rejects.toThrow(/Permission manquante/);
  });

  it("throws ConflictError when the code already exists", async () => {
    mockTxGet.mockResolvedValue({ exists: true });

    await expect(
      planCouponService.create(
        { code: "TEST2026", discountType: "percentage", discountValue: 25 },
        admin,
      ),
    ).rejects.toThrow(/existe déjà/);
  });

  it("commits a new coupon when the code is free", async () => {
    mockTxGet.mockResolvedValue({ exists: false });

    const created = await planCouponService.create(
      {
        code: "TEST2026",
        discountType: "percentage",
        discountValue: 25,
        maxUses: 100,
        maxUsesPerOrg: 1,
      },
      admin,
    );

    expect(created.code).toBe("TEST2026");
    expect(created.usedCount).toBe(0);
    expect(created.isActive).toBe(true);
    expect(mockTxSet).toHaveBeenCalled();
  });
});

describe("PlanCouponService.applyInTransaction — validations", () => {
  const tx = { get: mockTxGet, set: mockTxSet, update: mockTxUpdate } as unknown as Parameters<
    typeof planCouponService.applyInTransaction
  >[0];

  it("throws PlanLimitError when the coupon does not exist", async () => {
    mockTxGet.mockResolvedValueOnce({ exists: false });

    await expect(
      planCouponService.applyInTransaction(tx, {
        code: "MISSING",
        plan: buildPlan(),
        cycle: "monthly",
        organizationId: "org-1",
        subscriptionId: "sub-1",
        actorId: "user-1",
      }),
    ).rejects.toThrow(/Coupon introuvable/);
  });

  it("throws when the coupon is inactive", async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => buildCoupon({ isActive: false }),
    });

    await expect(
      planCouponService.applyInTransaction(tx, {
        code: "TEST2026",
        plan: buildPlan(),
        cycle: "monthly",
        organizationId: "org-1",
        subscriptionId: "sub-1",
        actorId: "user-1",
      }),
    ).rejects.toThrow(/désactivé/);
  });

  it("throws when the coupon has expired", async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => buildCoupon({ expiresAt: pastDate }),
    });

    await expect(
      planCouponService.applyInTransaction(tx, {
        code: "TEST2026",
        plan: buildPlan(),
        cycle: "monthly",
        organizationId: "org-1",
        subscriptionId: "sub-1",
        actorId: "user-1",
      }),
    ).rejects.toThrow(/expiré/);
  });

  it("throws when the coupon's max uses are exhausted", async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => buildCoupon({ maxUses: 10, usedCount: 10 }),
    });

    await expect(
      planCouponService.applyInTransaction(tx, {
        code: "TEST2026",
        plan: buildPlan(),
        cycle: "monthly",
        organizationId: "org-1",
        subscriptionId: "sub-1",
        actorId: "user-1",
      }),
    ).rejects.toThrow(/limite d'utilisation/);
  });

  it("throws when the target plan is not whitelisted", async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => buildCoupon({ appliedPlanIds: ["plan-enterprise"] }),
    });

    await expect(
      planCouponService.applyInTransaction(tx, {
        code: "TEST2026",
        plan: buildPlan({ id: "plan-pro" }),
        cycle: "monthly",
        organizationId: "org-1",
        subscriptionId: "sub-1",
        actorId: "user-1",
      }),
    ).rejects.toThrow(/ne s'applique pas au plan/);
  });

  it("throws when the billing cycle is not whitelisted", async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => buildCoupon({ appliedCycles: ["annual"] }),
    });

    await expect(
      planCouponService.applyInTransaction(tx, {
        code: "TEST2026",
        plan: buildPlan(),
        cycle: "monthly",
        organizationId: "org-1",
        subscriptionId: "sub-1",
        actorId: "user-1",
      }),
    ).rejects.toThrow(/ne s'applique pas au cycle/);
  });

  it("throws when the per-org cap is reached", async () => {
    mockTxGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => buildCoupon({ maxUsesPerOrg: 1 }),
      })
      // cap-check read returns one existing redemption from this org
      .mockResolvedValueOnce({ size: 1 });

    await expect(
      planCouponService.applyInTransaction(tx, {
        code: "TEST2026",
        plan: buildPlan(),
        cycle: "monthly",
        organizationId: "org-1",
        subscriptionId: "sub-1",
        actorId: "user-1",
      }),
    ).rejects.toThrow(/déjà utilisé ce coupon/);
  });

  it("bumps usedCount + writes redemption on happy path (percentage)", async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => buildCoupon({ discountValue: 25 }),
    });

    const result = await planCouponService.applyInTransaction(tx, {
      code: "TEST2026",
      plan: buildPlan({ priceXof: 29_900 }),
      cycle: "monthly",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      actorId: "user-1",
    });

    // 25% of 29 900 = 7 475 (floor)
    expect(result.discountXof).toBe(7_475);
    expect(result.finalPriceXof).toBe(22_425);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ usedCount: 1 }),
    );
    expect(mockTxSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        couponId: "TEST2026",
        organizationId: "org-1",
        subscriptionId: "sub-1",
        originalPriceXof: 29_900,
        discountAppliedXof: 7_475,
        finalPriceXof: 22_425,
      }),
    );
  });

  it("applies annual pricing when cycle='annual'", async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => buildCoupon({ discountType: "fixed", discountValue: 50_000 }),
    });

    const result = await planCouponService.applyInTransaction(tx, {
      code: "TEST2026",
      plan: buildPlan({ priceXof: 29_900, annualPriceXof: 299_000 }),
      cycle: "annual",
      organizationId: "org-1",
      subscriptionId: "sub-1",
      actorId: "user-1",
    });

    expect(result.originalPriceXof).toBe(299_000);
    expect(result.discountXof).toBe(50_000);
    expect(result.finalPriceXof).toBe(249_000);
  });
});

describe("PlanCouponService — admin CRUD", () => {
  const admin = buildSuperAdmin();

  it("get throws NotFoundError when the doc is missing", async () => {
    mockCouponDoc.get.mockResolvedValueOnce({ exists: false });
    await expect(planCouponService.get("MISSING", admin)).rejects.toThrow(/PlanCoupon/);
  });

  it("update rejects non-super_admin callers", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(
      planCouponService.update("TEST2026", { isActive: false }, participant),
    ).rejects.toThrow(/Permission manquante/);
  });

  it("archive flips isActive to false", async () => {
    mockTxGet.mockResolvedValueOnce({ exists: true });

    await planCouponService.archive("TEST2026", admin);

    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isActive: false }),
    );
  });
});
