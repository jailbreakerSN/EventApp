import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReceiptService } from "../receipt.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildSuperAdmin,
  buildEvent,
  buildPayment,
} from "@/__tests__/factories";

// ─── Mocks (vi.hoisted so they're available inside vi.mock factories) ──────

const { mockReceiptRepo, mockPaymentRepo, mockEventRepo, mockOrgRepo, mockUserRepo, mockEventBus } =
  vi.hoisted(() => ({
    mockReceiptRepo: {
      findByIdOrThrow: vi.fn(),
      findByPayment: vi.fn(),
      findByUser: vi.fn(),
      create: vi.fn(),
      generateReceiptNumber: vi.fn(),
    },
    mockPaymentRepo: {
      findByIdOrThrow: vi.fn(),
    },
    mockEventRepo: {
      findByIdOrThrow: vi.fn(),
    },
    mockOrgRepo: {
      findByIdOrThrow: vi.fn(),
    },
    mockUserRepo: {
      findById: vi.fn(),
    },
    mockEventBus: { emit: vi.fn() },
  }));

vi.mock("@/repositories/receipt.repository", () => ({
  receiptRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockReceiptRepo as Record<string, unknown>)[p as string],
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

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockOrgRepo as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/repositories/user.repository", () => ({
  userRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockUserRepo as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/events/event-bus", () => ({ eventBus: mockEventBus }));
vi.mock("@/context/request-context", () => ({ getRequestId: () => "test-request-id" }));
vi.mock("@/config/firebase", () => ({
  db: {},
  COLLECTIONS: {
    RECEIPTS: "receipts",
    PAYMENTS: "payments",
    EVENTS: "events",
    ORGANIZATIONS: "organizations",
    USERS: "users",
    COUNTERS: "counters",
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new ReceiptService();

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── generateReceipt ──────────────────────────────────────────────────────

describe("ReceiptService.generateReceipt", () => {
  const orgId = "org-1";
  const userId = "user-1";
  const user = buildAuthUser({ uid: userId, roles: ["participant"] });

  const payment = buildPayment({
    id: "pay-1",
    userId,
    eventId: "ev-1",
    organizationId: orgId,
    status: "succeeded",
    amount: 10000,
    method: "mock",
  });

  const event = buildEvent({
    id: "ev-1",
    organizationId: orgId,
    ticketTypes: [
      {
        id: "vip",
        name: "VIP",
        price: 10000,
        currency: "XOF",
        totalQuantity: 50,
        soldCount: 5,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
  });

  beforeEach(() => {
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockReceiptRepo.findByPayment.mockResolvedValue(null);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockUserRepo.findById.mockResolvedValue({
      uid: userId,
      displayName: "Amadou Diallo",
      email: "amadou@test.sn",
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue({ id: orgId, name: "Teranga Events" });
    mockReceiptRepo.generateReceiptNumber.mockResolvedValue("REC-2025-000001");
    mockReceiptRepo.create.mockImplementation(async (data: unknown) => ({
      ...(data as object),
      id: "receipt-new",
    }));
  });

  it("generates a receipt for a succeeded payment owned by the user", async () => {
    const result = await service.generateReceipt("pay-1", user);

    expect(result.id).toBe("receipt-new");
    expect(result.receiptNumber).toBe("REC-2025-000001");
    expect(result.paymentId).toBe("pay-1");
    expect(result.eventId).toBe("ev-1");
    expect(result.organizationId).toBe(orgId);
    expect(result.userId).toBe(userId);
    expect(result.amount).toBe(10000);
    expect(result.currency).toBe("XOF");
    expect(result.method).toBe("mock");
    expect(result.eventTitle).toBe(event.title);
    expect(result.ticketTypeName).toBe("VIP");
    expect(result.participantName).toBe("Amadou Diallo");
    expect(result.participantEmail).toBe("amadou@test.sn");
    expect(result.organizationName).toBe("Teranga Events");

    expect(mockReceiptRepo.create).toHaveBeenCalledTimes(1);
  });

  it("emits receipt.generated event after creation", async () => {
    await service.generateReceipt("pay-1", user);

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "receipt.generated",
      expect.objectContaining({
        receiptId: "receipt-new",
        paymentId: "pay-1",
        eventId: "ev-1",
        userId,
        amount: 10000,
        actorId: user.uid,
      }),
    );
  });

  it("returns existing receipt if one already exists for the payment", async () => {
    const existingReceipt = {
      id: "receipt-existing",
      receiptNumber: "REC-2025-000001",
      paymentId: "pay-1",
    };
    mockReceiptRepo.findByPayment.mockResolvedValue(existingReceipt);

    const result = await service.generateReceipt("pay-1", user);

    expect(result.id).toBe("receipt-existing");
    expect(mockReceiptRepo.create).not.toHaveBeenCalled();
    expect(mockEventBus.emit).not.toHaveBeenCalled();
  });

  it("rejects if payment is not succeeded", async () => {
    const processingPayment = { ...payment, status: "processing" };
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(processingPayment);

    await expect(service.generateReceipt("pay-1", user)).rejects.toThrow("paiement confirmé");
  });

  it("rejects if user lacks payment:read_own permission", async () => {
    const noPermUser = buildAuthUser({ roles: [] as never[] });
    await expect(service.generateReceipt("pay-1", noPermUser)).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("allows super_admin to generate receipt for any payment", async () => {
    const admin = buildSuperAdmin();

    const result = await service.generateReceipt("pay-1", admin);

    expect(result.id).toBe("receipt-new");
    expect(mockReceiptRepo.create).toHaveBeenCalledTimes(1);
  });

  it("requires payment:read_all and org access for non-owner non-admin", async () => {
    const otherUser = buildAuthUser({ uid: "other-user", roles: ["participant"] });

    await expect(service.generateReceipt("pay-1", otherUser)).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("allows organizer with payment:read_all to generate receipt for their org", async () => {
    const organizer = buildOrganizerUser(orgId);

    const result = await service.generateReceipt("pay-1", organizer);

    expect(result.id).toBe("receipt-new");
  });

  it("rejects organizer from different org", async () => {
    const otherOrg = buildOrganizerUser("org-other");

    await expect(service.generateReceipt("pay-1", otherOrg)).rejects.toThrow("Accès refusé");
  });

  it("uses fallback organization name when org lookup fails", async () => {
    mockOrgRepo.findByIdOrThrow.mockRejectedValue(new Error("Not found"));

    const result = await service.generateReceipt("pay-1", user);

    expect(result.organizationName).toBe("Teranga");
  });

  it("uses fallback participant name when user not found", async () => {
    mockUserRepo.findById.mockResolvedValue(null);

    const result = await service.generateReceipt("pay-1", user);

    expect(result.participantName).toBe("Participant");
    expect(result.participantEmail).toBeNull();
  });

  it("uses fallback ticket name when no ticket type matches", async () => {
    const eventNoTickets = buildEvent({
      id: "ev-1",
      organizationId: orgId,
      ticketTypes: [],
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventNoTickets);

    const result = await service.generateReceipt("pay-1", user);

    expect(result.ticketTypeName).toBe("Billet");
  });
});

// ─── getReceipt ───────────────────────────────────────────────────────────

describe("ReceiptService.getReceipt", () => {
  const orgId = "org-1";
  const userId = "user-1";

  it("returns receipt for the owner", async () => {
    const user = buildAuthUser({ uid: userId, roles: ["participant"] });
    const receipt = { id: "receipt-1", userId, organizationId: orgId };
    mockReceiptRepo.findByIdOrThrow.mockResolvedValue(receipt);

    const result = await service.getReceipt("receipt-1", user);

    expect(result.id).toBe("receipt-1");
  });

  it("allows super_admin to view any receipt", async () => {
    const admin = buildSuperAdmin();
    const receipt = { id: "receipt-1", userId: "other-user", organizationId: orgId };
    mockReceiptRepo.findByIdOrThrow.mockResolvedValue(receipt);

    const result = await service.getReceipt("receipt-1", admin);

    expect(result.id).toBe("receipt-1");
  });

  it("rejects if user lacks payment:read_own permission", async () => {
    const noPermUser = buildAuthUser({ roles: [] as never[] });
    await expect(service.getReceipt("receipt-1", noPermUser)).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("requires payment:read_all for non-owner non-admin access", async () => {
    const otherUser = buildAuthUser({ uid: "other-user", roles: ["participant"] });
    const receipt = { id: "receipt-1", userId, organizationId: orgId };
    mockReceiptRepo.findByIdOrThrow.mockResolvedValue(receipt);

    await expect(service.getReceipt("receipt-1", otherUser)).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("rejects organizer from different org for non-owned receipt", async () => {
    const otherOrg = buildOrganizerUser("org-other");
    const receipt = { id: "receipt-1", userId, organizationId: orgId };
    mockReceiptRepo.findByIdOrThrow.mockResolvedValue(receipt);

    await expect(service.getReceipt("receipt-1", otherOrg)).rejects.toThrow("Accès refusé");
  });
});

// ─── listMyReceipts ───────────────────────────────────────────────────────

describe("ReceiptService.listMyReceipts", () => {
  it("returns paginated receipts for the current user", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const mockResult = {
      data: [{ id: "receipt-1", userId: user.uid }],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    };
    mockReceiptRepo.findByUser.mockResolvedValue(mockResult);

    const result = await service.listMyReceipts(user, { page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(mockReceiptRepo.findByUser).toHaveBeenCalledWith(user.uid, { page: 1, limit: 20 });
  });

  it("rejects if user lacks payment:read_own permission", async () => {
    const noPermUser = buildAuthUser({ roles: [] as never[] });
    await expect(service.listMyReceipts(noPermUser, { page: 1, limit: 20 })).rejects.toThrow(
      "Permission manquante",
    );
  });
});
