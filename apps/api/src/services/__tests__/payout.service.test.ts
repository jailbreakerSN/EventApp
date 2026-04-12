import { describe, it, expect, vi, beforeEach } from "vitest";
import { PayoutService } from "../payout.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildSuperAdmin,
  buildEvent,
  buildPayment,
} from "@/__tests__/factories";

// ─── Mocks (vi.hoisted so they're available inside vi.mock factories) ──────

const { mockPayoutRepo, mockPaymentRepo, mockEventRepo, mockEventBus } = vi.hoisted(() => ({
  mockPayoutRepo: {
    findByIdOrThrow: vi.fn(),
    findByOrganization: vi.fn(),
    create: vi.fn(),
  },
  mockPaymentRepo: {
    findByEvent: vi.fn(),
  },
  mockEventRepo: {
    findByIdOrThrow: vi.fn(),
  },
  mockEventBus: { emit: vi.fn() },
}));

vi.mock("@/repositories/payout.repository", () => ({
  payoutRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockPayoutRepo as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/repositories/payment.repository", () => ({
  paymentRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockPaymentRepo as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockEventRepo as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/events/event-bus", () => ({ eventBus: mockEventBus }));
vi.mock("@/context/request-context", () => ({ getRequestId: () => "test-request-id" }));
vi.mock("@/config/firebase", () => ({
  db: {},
  COLLECTIONS: { PAYOUTS: "payouts", PAYMENTS: "payments", EVENTS: "events" },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new PayoutService();

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── calculatePayout ──────────────────────────────────────────────────────

describe("PayoutService.calculatePayout", () => {
  const orgId = "org-1";
  const event = buildEvent({ id: "ev-1", organizationId: orgId });
  const organizer = buildOrganizerUser(orgId);

  it("calculates payout with platform fee for filtered payments", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPaymentRepo.findByEvent.mockResolvedValue({
      data: [
        buildPayment({
          status: "succeeded",
          amount: 10000,
          refundedAmount: 0,
          completedAt: "2025-03-15T10:00:00Z",
        }),
        buildPayment({
          status: "succeeded",
          amount: 5000,
          refundedAmount: 1000,
          completedAt: "2025-03-16T10:00:00Z",
        }),
        // This one is outside the period
        buildPayment({
          status: "succeeded",
          amount: 20000,
          refundedAmount: 0,
          completedAt: "2025-04-01T10:00:00Z",
        }),
      ],
      meta: { total: 3, page: 1, limit: 10000, totalPages: 1 },
    });

    const result = await service.calculatePayout(
      "ev-1",
      "2025-03-01T00:00:00Z",
      "2025-03-31T23:59:59Z",
      organizer,
    );

    // totalAmount = (10000 - 0) + (5000 - 1000) = 14000
    expect(result.totalAmount).toBe(14000);
    // platformFee = Math.round(14000 * 0.05) = 700
    expect(result.platformFee).toBe(700);
    // netAmount = 14000 - 700 = 13300
    expect(result.netAmount).toBe(13300);
    expect(result.paymentCount).toBe(2);
  });

  it("returns zero values when no payments match the period", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPaymentRepo.findByEvent.mockResolvedValue({
      data: [
        buildPayment({
          status: "succeeded",
          amount: 10000,
          refundedAmount: 0,
          completedAt: "2025-05-01T10:00:00Z",
        }),
      ],
      meta: { total: 1, page: 1, limit: 10000, totalPages: 1 },
    });

    const result = await service.calculatePayout(
      "ev-1",
      "2025-03-01T00:00:00Z",
      "2025-03-31T23:59:59Z",
      organizer,
    );

    expect(result.totalAmount).toBe(0);
    expect(result.platformFee).toBe(0);
    expect(result.netAmount).toBe(0);
    expect(result.paymentCount).toBe(0);
  });

  it("falls back to createdAt when completedAt is null", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPaymentRepo.findByEvent.mockResolvedValue({
      data: [
        buildPayment({
          status: "succeeded",
          amount: 8000,
          refundedAmount: 0,
          completedAt: null,
          createdAt: "2025-03-10T10:00:00Z",
        }),
      ],
      meta: { total: 1, page: 1, limit: 10000, totalPages: 1 },
    });

    const result = await service.calculatePayout(
      "ev-1",
      "2025-03-01T00:00:00Z",
      "2025-03-31T23:59:59Z",
      organizer,
    );

    expect(result.paymentCount).toBe(1);
    expect(result.totalAmount).toBe(8000);
  });

  it("rejects if user lacks payout:read permission", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.calculatePayout("ev-1", "2025-03-01", "2025-03-31", participant),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects if user is not in the event's organization", async () => {
    const otherOrg = buildOrganizerUser("org-other");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.calculatePayout("ev-1", "2025-03-01", "2025-03-31", otherOrg),
    ).rejects.toThrow("Accès refusé");
  });

  it("allows super_admin regardless of organization", async () => {
    const admin = buildSuperAdmin();
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPaymentRepo.findByEvent.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 10000, totalPages: 1 },
    });

    const result = await service.calculatePayout(
      "ev-1",
      "2025-03-01T00:00:00Z",
      "2025-03-31T23:59:59Z",
      admin,
    );

    expect(result.paymentCount).toBe(0);
  });
});

// ─── createPayout ─────────────────────────────────────────────────────────

describe("PayoutService.createPayout", () => {
  const orgId = "org-1";
  const event = buildEvent({ id: "ev-1", organizationId: orgId });
  const organizer = buildOrganizerUser(orgId);

  it("creates a payout record and emits event", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPaymentRepo.findByEvent.mockResolvedValue({
      data: [
        buildPayment({
          id: "pay-1",
          status: "succeeded",
          amount: 10000,
          refundedAmount: 0,
          completedAt: "2025-03-15T10:00:00Z",
        }),
        buildPayment({
          id: "pay-2",
          status: "succeeded",
          amount: 5000,
          refundedAmount: 500,
          completedAt: "2025-03-16T10:00:00Z",
        }),
      ],
      meta: { total: 2, page: 1, limit: 10000, totalPages: 1 },
    });
    mockPayoutRepo.create.mockImplementation(async (data: unknown) => ({
      ...(data as object),
      id: "payout-new",
    }));

    const result = await service.createPayout(
      "ev-1",
      "2025-03-01T00:00:00Z",
      "2025-03-31T23:59:59Z",
      organizer,
    );

    expect(result.id).toBe("payout-new");
    expect(result.organizationId).toBe(orgId);
    expect(result.eventId).toBe("ev-1");
    expect(result.status).toBe("pending");
    expect(result.paymentIds).toEqual(["pay-1", "pay-2"]);
    // totalAmount = (10000 - 0) + (5000 - 500) = 14500
    expect(result.totalAmount).toBe(14500);
    expect(result.platformFeeRate).toBe(0.05);

    expect(mockPayoutRepo.create).toHaveBeenCalledTimes(1);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "payout.created",
      expect.objectContaining({
        payoutId: "payout-new",
        eventId: "ev-1",
        organizationId: orgId,
        actorId: organizer.uid,
      }),
    );
  });

  it("rejects if no payments match the period", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPaymentRepo.findByEvent.mockResolvedValue({
      data: [
        buildPayment({
          status: "succeeded",
          amount: 10000,
          refundedAmount: 0,
          completedAt: "2025-05-01T10:00:00Z",
        }),
      ],
      meta: { total: 1, page: 1, limit: 10000, totalPages: 1 },
    });

    await expect(
      service.createPayout("ev-1", "2025-03-01T00:00:00Z", "2025-03-31T23:59:59Z", organizer),
    ).rejects.toThrow("Aucun paiement confirmé");
  });

  it("rejects if user lacks payout:create permission", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.createPayout("ev-1", "2025-03-01", "2025-03-31", participant),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects if user is not in the event's organization", async () => {
    const otherOrg = buildOrganizerUser("org-other");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.createPayout("ev-1", "2025-03-01", "2025-03-31", otherOrg),
    ).rejects.toThrow("Accès refusé");
  });
});

// ─── listPayouts ──────────────────────────────────────────────────────────

describe("PayoutService.listPayouts", () => {
  const orgId = "org-1";
  const organizer = buildOrganizerUser(orgId);

  it("returns paginated payouts for an organization", async () => {
    const mockResult = {
      data: [{ id: "payout-1", organizationId: orgId }],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    };
    mockPayoutRepo.findByOrganization.mockResolvedValue(mockResult);

    const result = await service.listPayouts(orgId, {}, { page: 1, limit: 20 }, organizer);

    expect(result.data).toHaveLength(1);
    expect(mockPayoutRepo.findByOrganization).toHaveBeenCalledWith(
      orgId,
      {},
      { page: 1, limit: 20 },
    );
  });

  it("passes status filter to repository", async () => {
    mockPayoutRepo.findByOrganization.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });

    await service.listPayouts(orgId, { status: "pending" }, { page: 1, limit: 20 }, organizer);

    expect(mockPayoutRepo.findByOrganization).toHaveBeenCalledWith(
      orgId,
      { status: "pending" },
      { page: 1, limit: 20 },
    );
  });

  it("rejects if user lacks payout:read permission", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.listPayouts(orgId, {}, { page: 1, limit: 20 }, participant),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects if user is not in the organization", async () => {
    const otherOrg = buildOrganizerUser("org-other");
    await expect(service.listPayouts(orgId, {}, { page: 1, limit: 20 }, otherOrg)).rejects.toThrow(
      "Accès refusé",
    );
  });

  it("allows super_admin regardless of organization", async () => {
    const admin = buildSuperAdmin();
    mockPayoutRepo.findByOrganization.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });

    await service.listPayouts(orgId, {}, { page: 1, limit: 20 }, admin);

    expect(mockPayoutRepo.findByOrganization).toHaveBeenCalled();
  });
});

// ─── getPayoutDetail ──────────────────────────────────────────────────────

describe("PayoutService.getPayoutDetail", () => {
  const orgId = "org-1";
  const organizer = buildOrganizerUser(orgId);

  it("returns payout detail for authorized user", async () => {
    const payout = { id: "payout-1", organizationId: orgId, status: "pending" };
    mockPayoutRepo.findByIdOrThrow.mockResolvedValue(payout);

    const result = await service.getPayoutDetail("payout-1", organizer);

    expect(result.id).toBe("payout-1");
    expect(mockPayoutRepo.findByIdOrThrow).toHaveBeenCalledWith("payout-1");
  });

  it("rejects if user lacks payout:read permission", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(service.getPayoutDetail("payout-1", participant)).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("rejects if user is not in the payout's organization", async () => {
    const otherOrg = buildOrganizerUser("org-other");
    const payout = { id: "payout-1", organizationId: orgId };
    mockPayoutRepo.findByIdOrThrow.mockResolvedValue(payout);

    await expect(service.getPayoutDetail("payout-1", otherOrg)).rejects.toThrow("Accès refusé");
  });

  it("allows super_admin regardless of organization", async () => {
    const admin = buildSuperAdmin();
    const payout = { id: "payout-1", organizationId: orgId, status: "pending" };
    mockPayoutRepo.findByIdOrThrow.mockResolvedValue(payout);

    const result = await service.getPayoutDetail("payout-1", admin);

    expect(result.id).toBe("payout-1");
  });
});
