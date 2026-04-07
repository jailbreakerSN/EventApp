import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentService } from "../payment.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildEvent,
  buildPayment,
  buildRegistration,
} from "@/__tests__/factories";
import type { Payment, Registration, Event } from "@teranga/shared-types";

// ─── Mocks (vi.hoisted so they're available inside vi.mock factories) ──────

const {
  mockEventRepo,
  mockRegRepo,
  mockPaymentRepo,
  mockProvider,
  mockEventBus,
  mockDocUpdate,
  mockTxGet,
  mockTxUpdate,
  mockTxSet,
  mockRunTransaction,
} = vi.hoisted(() => {
  const _mockEventRepo = {
    findByIdOrThrow: vi.fn(),
  };
  const _mockRegRepo = {
    findOne: vi.fn(),
    update: vi.fn(),
  };
  const _mockPaymentRepo = {
    findByIdOrThrow: vi.fn(),
    findByProviderTransactionId: vi.fn(),
    findByEvent: vi.fn(),
    update: vi.fn(),
  };
  const _mockProvider = {
    name: "mock",
    initiate: vi.fn(),
    verify: vi.fn(),
    refund: vi.fn(),
  };
  const _mockEventBus = { emit: vi.fn() };
  const _mockDocUpdate = vi.fn();
  const _mockTxGet = vi.fn();
  const _mockTxUpdate = vi.fn();
  const _mockTxSet = vi.fn();
  const _mockRunTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = { get: _mockTxGet, update: _mockTxUpdate, set: _mockTxSet };
    return fn(tx);
  });
  return {
    mockEventRepo: _mockEventRepo,
    mockRegRepo: _mockRegRepo,
    mockPaymentRepo: _mockPaymentRepo,
    mockProvider: _mockProvider,
    mockEventBus: _mockEventBus,
    mockDocUpdate: _mockDocUpdate,
    mockTxGet: _mockTxGet,
    mockTxUpdate: _mockTxUpdate,
    mockTxSet: _mockTxSet,
    mockRunTransaction: _mockRunTransaction,
  };
});

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy({}, {
    get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/registration.repository", () => ({
  registrationRepository: new Proxy({}, {
    get: (_target, prop) => (mockRegRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/payment.repository", () => ({
  paymentRepository: new Proxy({}, {
    get: (_target, prop) => (mockPaymentRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: mockEventBus,
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

vi.mock("@/services/qr-signing", () => ({
  signQrPayload: vi.fn(() => "signed-qr-code"),
}));

vi.mock("@/providers/mock-payment.provider", () => ({
  mockPaymentProvider: {
    name: "mock",
    initiate: (...args: unknown[]) => mockProvider.initiate(...args),
    verify: (...args: unknown[]) => mockProvider.verify(...args),
    refund: (...args: unknown[]) => mockProvider.refund(...args),
  },
}));

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ id: "mock-doc-id", update: mockDocUpdate })),
      where: vi.fn(() => ({
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              // Used by tx.get() for the duplicate check query
            })),
          })),
        })),
      })),
    })),
    batch: vi.fn(() => ({
      set: vi.fn(),
      commit: vi.fn(),
    })),
    runTransaction: (...args: unknown[]) => mockRunTransaction(...args as [unknown]),
  },
  COLLECTIONS: {
    REGISTRATIONS: "registrations",
    EVENTS: "events",
    PAYMENTS: "payments",
  },
}));

vi.mock("@/repositories/transaction.helper", () => ({
  FieldValue: {
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new PaymentService();

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── initiatePayment ───────────────────────────────────────────────────────

describe("PaymentService.initiatePayment", () => {
  const orgId = "org-1";
  const event = buildEvent({
    id: "ev-1",
    organizationId: orgId,
    status: "published",
    ticketTypes: [
      {
        id: "vip",
        name: "VIP",
        price: 10000,
        currency: "XOF",
        totalQuantity: 50,
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      },
      {
        id: "free",
        name: "Gratuit",
        price: 0,
        currency: "XOF",
        totalQuantity: 100,
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
  });
  const user = buildAuthUser({ roles: ["participant"] });

  it("creates registration and payment in a transaction", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockProvider.initiate.mockResolvedValue({
      providerTransactionId: "mock_tx_123",
      redirectUrl: "http://mock-checkout/mock_tx_123",
    });
    // Transaction duplicate check returns empty
    mockTxGet.mockResolvedValue({ empty: true });

    const result = await service.initiatePayment("ev-1", "vip", "mock", undefined, user);

    expect(result).toHaveProperty("paymentId");
    expect(result).toHaveProperty("redirectUrl");
    expect(mockRunTransaction).toHaveBeenCalled();
    expect(mockTxSet).toHaveBeenCalledTimes(2); // registration + payment
    expect(mockProvider.initiate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10000, currency: "XOF" }),
    );
  });

  it("emits payment.initiated event", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockProvider.initiate.mockResolvedValue({
      providerTransactionId: "mock_tx_123",
      redirectUrl: "http://mock-checkout/mock_tx_123",
    });
    mockTxGet.mockResolvedValue({ empty: true });

    await service.initiatePayment("ev-1", "vip", "mock", undefined, user);

    expect(mockEventBus.emit).toHaveBeenCalledWith("payment.initiated", expect.objectContaining({
      eventId: "ev-1",
      amount: 10000,
      method: "mock",
      actorId: user.uid,
    }));
  });

  it("rejects if user lacks payment:initiate permission", async () => {
    const noPermUser = buildAuthUser({ roles: [] as never[] });
    await expect(
      service.initiatePayment("ev-1", "vip", "mock", undefined, noPermUser),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects if event is not published", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue({ ...event, status: "draft" });
    await expect(
      service.initiatePayment("ev-1", "vip", "mock", undefined, user),
    ).rejects.toThrow();
  });

  it("rejects if ticket type not found", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    await expect(
      service.initiatePayment("ev-1", "nonexistent", "mock", undefined, user),
    ).rejects.toThrow("introuvable");
  });

  it("rejects if ticket is free", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    await expect(
      service.initiatePayment("ev-1", "free", "mock", undefined, user),
    ).rejects.toThrow("gratuit");
  });

  it("rejects duplicate registration inside transaction", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockProvider.initiate.mockResolvedValue({
      providerTransactionId: "mock_tx_123",
      redirectUrl: "http://mock-checkout/mock_tx_123",
    });
    // Transaction duplicate check returns existing registration
    mockTxGet.mockResolvedValue({ empty: false });

    await expect(
      service.initiatePayment("ev-1", "vip", "mock", undefined, user),
    ).rejects.toThrow("déjà inscrit");
  });

  it("rejects if ticket is sold out", async () => {
    const soldOutEvent = {
      ...event,
      ticketTypes: [{ ...event.ticketTypes[0], soldCount: 50 }],
    };
    mockEventRepo.findByIdOrThrow.mockResolvedValue(soldOutEvent);
    await expect(
      service.initiatePayment("ev-1", "vip", "mock", undefined, user),
    ).rejects.toThrow();
  });

  it("rejects for unsupported payment method", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    await expect(
      service.initiatePayment("ev-1", "vip", "wave" as never, undefined, user),
    ).rejects.toThrow("non disponible");
  });
});

// ─── handleWebhook ─────────────────────────────────────────────────────────

describe("PaymentService.handleWebhook", () => {
  it("confirms payment, registration, and increments counters in transaction", async () => {
    const payment = buildPayment({ status: "processing", ticketTypeId: "vip" });
    const reg = buildRegistration({ id: payment.registrationId, ticketTypeId: "vip" });
    const event = buildEvent({ id: payment.eventId, ticketTypes: [{ id: "vip", name: "VIP", price: 5000, currency: "XOF", totalQuantity: 50, soldCount: 10, accessZoneIds: [], isVisible: true }] });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);

    // Transaction reads
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment })   // payment re-read
      .mockResolvedValueOnce({ exists: true, data: () => reg })       // registration
      .mockResolvedValueOnce({ exists: true, data: () => event });    // event

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    expect(mockRunTransaction).toHaveBeenCalled();
    // 4 updates: payment + registration + event counter + ticketTypes
    expect(mockTxUpdate).toHaveBeenCalledTimes(4);
  });

  it("emits payment.succeeded event", async () => {
    const payment = buildPayment({ status: "processing" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment })
      .mockResolvedValueOnce({ exists: true, data: () => buildRegistration() })
      .mockResolvedValueOnce({ exists: true, data: () => buildEvent() });

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    expect(mockEventBus.emit).toHaveBeenCalledWith("payment.succeeded", expect.objectContaining({
      paymentId: payment.id,
      amount: payment.amount,
    }));
  });

  it("skips if payment already in terminal state", async () => {
    const payment = buildPayment({ status: "succeeded" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("skips inside transaction if payment became terminal concurrently", async () => {
    const payment = buildPayment({ status: "processing" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    // Fresh read inside tx shows succeeded (concurrent webhook won)
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => ({ ...payment, status: "succeeded" }) });

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    expect(mockRunTransaction).toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled(); // Skipped due to idempotency
  });

  it("marks payment as failed and cancels registration atomically", async () => {
    const payment = buildPayment({ status: "processing" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => payment });

    await service.handleWebhook(payment.providerTransactionId!, "failed", { reason: "Solde insuffisant" });

    expect(mockRunTransaction).toHaveBeenCalled();
    expect(mockTxUpdate).toHaveBeenCalledTimes(2); // payment + registration
    expect(mockEventBus.emit).toHaveBeenCalledWith("payment.failed", expect.objectContaining({
      paymentId: payment.id,
    }));
  });

  it("throws NotFoundError for unknown transaction", async () => {
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(null);
    await expect(
      service.handleWebhook("unknown_tx", "succeeded"),
    ).rejects.toThrow();
  });

  it("throws NotFoundError if registration missing during success webhook", async () => {
    const payment = buildPayment({ status: "processing" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment })
      .mockResolvedValueOnce({ exists: false }); // registration doesn't exist

    await expect(
      service.handleWebhook(payment.providerTransactionId!, "succeeded"),
    ).rejects.toThrow();
  });
});

// ─── getPaymentStatus ──────────────────────────────────────────────────────

describe("PaymentService.getPaymentStatus", () => {
  it("returns payment for owner", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const payment = buildPayment({ userId: user.uid });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    const result = await service.getPaymentStatus(payment.id, user);
    expect(result.id).toBe(payment.id);
  });

  it("rejects if user lacks permission", async () => {
    const user = buildAuthUser({ roles: [] as never[] });
    await expect(
      service.getPaymentStatus("pay-1", user),
    ).rejects.toThrow("Permission manquante");
  });

  it("requires payment:read_all for non-owner access", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const payment = buildPayment({ userId: "other-user", organizationId: "org-1" });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(
      service.getPaymentStatus(payment.id, user),
    ).rejects.toThrow("Permission manquante");
  });
});

// ─── listEventPayments ─────────────────────────────────────────────────────

describe("PaymentService.listEventPayments", () => {
  const orgId = "org-1";
  const event = buildEvent({ id: "ev-1", organizationId: orgId });
  const organizer = buildOrganizerUser(orgId);

  it("returns paginated payments for an event", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    const mockResult = {
      data: [buildPayment({ eventId: "ev-1" })],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    };
    mockPaymentRepo.findByEvent.mockResolvedValue(mockResult);

    const result = await service.listEventPayments("ev-1", {}, { page: 1, limit: 20 }, organizer);

    expect(result.data).toHaveLength(1);
    expect(mockPaymentRepo.findByEvent).toHaveBeenCalledWith("ev-1", {}, { page: 1, limit: 20 });
  });

  it("passes filters to repository", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPaymentRepo.findByEvent.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });

    await service.listEventPayments("ev-1", { status: "succeeded", method: "mock" }, { page: 1, limit: 20 }, organizer);

    expect(mockPaymentRepo.findByEvent).toHaveBeenCalledWith("ev-1", { status: "succeeded", method: "mock" }, { page: 1, limit: 20 });
  });

  it("rejects if user lacks payment:read_all permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.listEventPayments("ev-1", {}, { page: 1, limit: 20 }, user),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects if user is not in the event's organization", async () => {
    const otherOrgUser = buildOrganizerUser("other-org");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    await expect(
      service.listEventPayments("ev-1", {}, { page: 1, limit: 20 }, otherOrgUser),
    ).rejects.toThrow("Accès refusé");
  });
});

// ─── getEventPaymentSummary ────────────────────────────────────────────────

describe("PaymentService.getEventPaymentSummary", () => {
  const orgId = "org-1";
  const event = buildEvent({ id: "ev-1", organizationId: orgId });
  const organizer = buildOrganizerUser(orgId);

  it("returns aggregated payment summary", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockPaymentRepo.findByEvent.mockResolvedValue({
      data: [
        buildPayment({ status: "succeeded", amount: 5000, refundedAmount: 0, method: "mock" }),
        buildPayment({ status: "succeeded", amount: 10000, refundedAmount: 2000, method: "mock" }),
        buildPayment({ status: "failed", amount: 5000, refundedAmount: 0, method: "mock" }),
      ],
      meta: { total: 3, page: 1, limit: 10000, totalPages: 1 },
    });

    const summary = await service.getEventPaymentSummary("ev-1", organizer);

    expect(summary.totalRevenue).toBe(15000);
    expect(summary.totalRefunded).toBe(2000);
    expect(summary.netRevenue).toBe(13000);
    expect(summary.paymentCount).toBe(3);
    expect(summary.byStatus.succeeded).toBe(2);
    expect(summary.byStatus.failed).toBe(1);
  });

  it("rejects if user lacks payment:view_reports permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.getEventPaymentSummary("ev-1", user),
    ).rejects.toThrow("Permission manquante");
  });
});

// ─── refundPayment ─────────────────────────────────────────────────────────

describe("PaymentService.refundPayment", () => {
  const orgId = "org-1";
  const organizer = buildOrganizerUser(orgId);

  it("performs a full refund atomically and cancels registration", async () => {
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 5000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce({ ...payment, status: "refunded", refundedAmount: 5000 });
    mockProvider.refund.mockResolvedValue({ success: true, providerRefundId: "ref_1" });

    await service.refundPayment(payment.id, undefined, "Annulé par l'organisateur", organizer);

    expect(mockRunTransaction).toHaveBeenCalled();
    expect(mockProvider.refund).toHaveBeenCalledWith(payment.providerTransactionId, 5000);
    // Transaction updates: payment + registration + event counter
    expect(mockTxUpdate).toHaveBeenCalledTimes(3);
    expect(mockEventBus.emit).toHaveBeenCalledWith("payment.refunded", expect.objectContaining({
      paymentId: payment.id,
      amount: 5000,
      reason: "Annulé par l'organisateur",
    }));
  });

  it("performs a partial refund without cancelling registration", async () => {
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 10000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce({ ...payment, refundedAmount: 3000 });
    mockProvider.refund.mockResolvedValue({ success: true });

    await service.refundPayment(payment.id, 3000, undefined, organizer);

    expect(mockRunTransaction).toHaveBeenCalled();
    // Partial refund: only payment update (no registration cancel, no event decrement)
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects if payment is not succeeded", async () => {
    const payment = buildPayment({ status: "processing", organizationId: orgId });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(
      service.refundPayment(payment.id, undefined, undefined, organizer),
    ).rejects.toThrow("confirmé");
  });

  it("rejects if refund amount exceeds remaining balance", async () => {
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 5000,
      refundedAmount: 4000,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(
      service.refundPayment(payment.id, 2000, undefined, organizer),
    ).rejects.toThrow("dépasse");
  });

  it("rejects if refund amount is zero or negative", async () => {
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 5000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(
      service.refundPayment(payment.id, 0, undefined, organizer),
    ).rejects.toThrow("positif");
  });

  it("rejects if user lacks payment:refund permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.refundPayment("pay-1", undefined, undefined, user),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects if provider refuses refund", async () => {
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 5000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockProvider.refund.mockResolvedValue({ success: false });

    await expect(
      service.refundPayment(payment.id, undefined, undefined, organizer),
    ).rejects.toThrow("refusé");
  });
});
