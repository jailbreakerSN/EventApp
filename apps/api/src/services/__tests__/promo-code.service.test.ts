import { describe, it, expect, vi, beforeEach } from "vitest";
import { PromoCodeService } from "../promo-code.service";
import { buildOrganizerUser, buildAuthUser, buildEvent, buildOrganization } from "@/__tests__/factories";
import { type PromoCode } from "@teranga/shared-types";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockPromoCodeRepo = {
  create: vi.fn(),
  findByCode: vi.fn(),
  findByEvent: vi.fn(),
  findByIdOrThrow: vi.fn(),
  update: vi.fn(),
};

const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

vi.mock("@/repositories/promo-code.repository", () => ({
  promoCodeRepository: new Proxy({}, {
    get: (_target, prop) => (mockPromoCodeRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy({}, {
    get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy({}, {
    get: (_target, prop) => (mockOrgRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Mock db for transactional applyPromoCode
const mockTxUpdate = vi.fn();
const mockTxGet = vi.fn();
const mockDocRef = { id: "mock-doc" };

vi.mock("@/config/firebase", () => ({
  db: {
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { get: mockTxGet, update: mockTxUpdate };
      return fn(tx);
    }),
    collection: vi.fn(() => ({
      doc: vi.fn(() => mockDocRef),
    })),
  },
  COLLECTIONS: { PROMO_CODES: "promoCodes", EVENTS: "events" },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new PromoCodeService();

beforeEach(() => {
  vi.clearAllMocks();
  // PromoCodeService mutations are gated behind `promoCodes` (starter+).
  mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrganization({ id: "org-1", plan: "starter" }));
});

// ─── createPromoCode ────────────────────────────────────────────────────────

describe("PromoCodeService.createPromoCode", () => {
  const event = buildEvent({ id: "event-1", organizationId: "org-1" });

  it("creates a promo code and emits domain event", async () => {
    const user = buildOrganizerUser("org-1");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPromoCodeRepo.findByCode.mockResolvedValue(null);
    const created: PromoCode = {
      id: "promo-1",
      eventId: "event-1",
      organizationId: "org-1",
      code: "TERANGA20",
      discountType: "percentage",
      discountValue: 20,
      maxUses: 100,
      usedCount: 0,
      expiresAt: null,
      ticketTypeIds: [],
      isActive: true,
      createdBy: user.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockPromoCodeRepo.create.mockResolvedValue(created);

    const result = await service.createPromoCode(
      {
        eventId: "event-1",
        code: "TERANGA20",
        discountType: "percentage",
        discountValue: 20,
        maxUses: 100,
      },
      user,
    );

    expect(result.code).toBe("TERANGA20");
    expect(mockPromoCodeRepo.create).toHaveBeenCalledOnce();
    const { eventBus } = await import("@/events/event-bus");
    expect(eventBus.emit).toHaveBeenCalledWith("promo_code.created", expect.objectContaining({
      promoCodeId: "promo-1",
      eventId: "event-1",
    }));
  });

  it("rejects if user lacks permission (participant)", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.createPromoCode(
        { eventId: "event-1", code: "TEST", discountType: "fixed", discountValue: 1000 },
        participant,
      ),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects if user belongs to a different organization", async () => {
    const otherOrgUser = buildOrganizerUser("org-other");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.createPromoCode(
        { eventId: "event-1", code: "TEST", discountType: "fixed", discountValue: 1000 },
        otherOrgUser,
      ),
    ).rejects.toThrow("Accès refusé");
  });

  it("rejects duplicate code on same event", async () => {
    const user = buildOrganizerUser("org-1");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPromoCodeRepo.findByCode.mockResolvedValue({ id: "existing", code: "DUP" });

    await expect(
      service.createPromoCode(
        { eventId: "event-1", code: "DUP", discountType: "fixed", discountValue: 1000 },
        user,
      ),
    ).rejects.toThrow("existe déjà");
  });

  it("rejects percentage discount > 100", async () => {
    const user = buildOrganizerUser("org-1");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPromoCodeRepo.findByCode.mockResolvedValue(null);

    await expect(
      service.createPromoCode(
        { eventId: "event-1", code: "BAD", discountType: "percentage", discountValue: 150 },
        user,
      ),
    ).rejects.toThrow("entre 1 et 100");
  });
});

// ─── validatePromoCode ──────────────────────────────────────────────────────

describe("PromoCodeService.validatePromoCode", () => {
  const basePromo: PromoCode = {
    id: "promo-1",
    eventId: "event-1",
    organizationId: "org-1",
    code: "VALID20",
    discountType: "percentage",
    discountValue: 20,
    maxUses: 100,
    usedCount: 5,
    expiresAt: null,
    ticketTypeIds: [],
    isActive: true,
    createdBy: "user-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("returns valid result for a valid promo code", async () => {
    mockPromoCodeRepo.findByCode.mockResolvedValue({ ...basePromo });

    const result = await service.validatePromoCode("event-1", "VALID20", "ticket-1");

    expect(result.valid).toBe(true);
    expect(result.discountType).toBe("percentage");
    expect(result.discountValue).toBe(20);
  });

  it("rejects expired code", async () => {
    const expired = {
      ...basePromo,
      expiresAt: new Date(Date.now() - 86400000).toISOString(),
    };
    mockPromoCodeRepo.findByCode.mockResolvedValue(expired);

    await expect(
      service.validatePromoCode("event-1", "VALID20", "ticket-1"),
    ).rejects.toThrow("expiré");
  });

  it("rejects maxed out code", async () => {
    const maxed = { ...basePromo, maxUses: 5, usedCount: 5 };
    mockPromoCodeRepo.findByCode.mockResolvedValue(maxed);

    await expect(
      service.validatePromoCode("event-1", "VALID20", "ticket-1"),
    ).rejects.toThrow("nombre maximum");
  });

  it("rejects code for wrong ticket type", async () => {
    const restricted = { ...basePromo, ticketTypeIds: ["ticket-vip"] };
    mockPromoCodeRepo.findByCode.mockResolvedValue(restricted);

    await expect(
      service.validatePromoCode("event-1", "VALID20", "ticket-standard"),
    ).rejects.toThrow("ne s'applique pas");
  });

  it("rejects inactive code", async () => {
    const inactive = { ...basePromo, isActive: false };
    mockPromoCodeRepo.findByCode.mockResolvedValue(inactive);

    await expect(
      service.validatePromoCode("event-1", "VALID20", "ticket-1"),
    ).rejects.toThrow("plus actif");
  });

  it("rejects non-existent code", async () => {
    mockPromoCodeRepo.findByCode.mockResolvedValue(null);

    await expect(
      service.validatePromoCode("event-1", "NONEXISTENT", "ticket-1"),
    ).rejects.toThrow("introuvable");
  });
});

// ─── applyPromoCode ─────────────────────────────────────────────────────────

describe("PromoCodeService.applyPromoCode", () => {
  it("increments usedCount via transaction", async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      id: "promo-1",
      data: () => ({
        code: "APPLY10",
        usedCount: 3,
        maxUses: 100,
      }),
    });

    await service.applyPromoCode("promo-1");

    expect(mockTxUpdate).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({ usedCount: 4 }),
    );

    const { eventBus } = await import("@/events/event-bus");
    expect(eventBus.emit).toHaveBeenCalledWith("promo_code.used", expect.objectContaining({
      promoCodeId: "promo-1",
    }));
  });

  it("rejects if promo code does not exist in transaction", async () => {
    mockTxGet.mockResolvedValue({ exists: false });

    await expect(service.applyPromoCode("missing")).rejects.toThrow("introuvable");
  });

  it("rejects if maxUses reached inside transaction", async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      id: "promo-1",
      data: () => ({
        code: "MAXED",
        usedCount: 10,
        maxUses: 10,
      }),
    });

    await expect(service.applyPromoCode("promo-1")).rejects.toThrow("nombre maximum");
  });
});

// ─── listPromoCodes ─────────────────────────────────────────────────────────

describe("PromoCodeService.listPromoCodes", () => {
  const event = buildEvent({ id: "event-1", organizationId: "org-1" });

  it("lists promo codes for authorized organizer", async () => {
    const user = buildOrganizerUser("org-1");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPromoCodeRepo.findByEvent.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const result = await service.listPromoCodes("event-1", { page: 1, limit: 20 }, user);

    expect(result.data).toEqual([]);
    expect(mockPromoCodeRepo.findByEvent).toHaveBeenCalledWith("event-1", { page: 1, limit: 20 });
  });

  it("rejects for user from different organization", async () => {
    const otherUser = buildOrganizerUser("org-other");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.listPromoCodes("event-1", { page: 1, limit: 20 }, otherUser),
    ).rejects.toThrow("Accès refusé");
  });
});

// ─── deactivatePromoCode ────────────────────────────────────────────────────

describe("PromoCodeService.deactivatePromoCode", () => {
  const event = buildEvent({ id: "event-1", organizationId: "org-1" });
  const promoCode: PromoCode = {
    id: "promo-1",
    eventId: "event-1",
    organizationId: "org-1",
    code: "DEACT",
    discountType: "fixed",
    discountValue: 5000,
    maxUses: null,
    usedCount: 0,
    expiresAt: null,
    ticketTypeIds: [],
    isActive: true,
    createdBy: "user-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("deactivates the promo code", async () => {
    const user = buildOrganizerUser("org-1");
    mockPromoCodeRepo.findByIdOrThrow.mockResolvedValue(promoCode);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPromoCodeRepo.update.mockResolvedValue(undefined);

    await service.deactivatePromoCode("promo-1", user);

    expect(mockPromoCodeRepo.update).toHaveBeenCalledWith("promo-1", { isActive: false });
  });

  it("rejects for user from different organization", async () => {
    const otherUser = buildOrganizerUser("org-other");
    mockPromoCodeRepo.findByIdOrThrow.mockResolvedValue(promoCode);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.deactivatePromoCode("promo-1", otherUser),
    ).rejects.toThrow("Accès refusé");
  });

  it("rejects for participant without permission", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });

    await expect(
      service.deactivatePromoCode("promo-1", participant),
    ).rejects.toThrow("Permission manquante");
  });
});
