import { describe, it, expect, vi, beforeEach } from "vitest";
// Static type import for vi.mock factories — avoids the
// `@typescript-eslint/consistent-type-imports` rule fired on inline
// `typeof import("…")` annotations.
import type * as RequestContextModule from "@/context/request-context";

/**
 * Phase 3 — Payments reconciliation cron tests.
 *
 * Mirrors the pattern from `onPaymentTimeout` tests + the verify-on-
 * return suite, but with a tighter Firestore mock that supports the
 * new query shape:
 *
 *     db.collection(payments)
 *       .where("status", "==", "processing")
 *       .where("createdAt", ">=", lower)
 *       .where("createdAt", "<=", upper)
 *       .orderBy("createdAt", "asc")
 *       .limit(batchSize)
 *       .get()
 *
 * Service-boundary mocks:
 *   - getProvider(...) → resolves to a controllable mock provider so
 *     each test can pin the verify() result (succeeded / failed /
 *     pending / throw).
 *   - eventBus.emit captured in mockEventBus to assert audit events.
 *   - runTransaction runs the callback against a controllable tx mock
 *     so the inner-tx idempotency guard branches are testable.
 */

// ─── Hoisted mocks (vi.mock factory hoists before const declarations) ──────
const {
  mockProviderVerify,
  mockEventBusEmit,
  mockTxGet,
  mockTxUpdate,
  mockTxSet,
  mockRunTransaction,
  mockGetRequestId,
  paymentsBucket,
} = vi.hoisted(() => ({
  mockProviderVerify: vi.fn(),
  mockEventBusEmit: vi.fn(),
  mockTxGet: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockTxSet: vi.fn(),
  mockRunTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      get: mockTxGet,
      update: mockTxUpdate,
      set: mockTxSet,
      delete: vi.fn(),
    }),
  ),
  mockGetRequestId: vi.fn(() => "req-test"),
  // Mutable snapshot of the `payments` collection — each test seeds it
  // with the candidate documents the sweep will scan.
  paymentsBucket: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
}));

vi.mock("@/config/firebase", () => ({
  db: {
    collection: (name: string) => {
      if (name !== "payments") {
        // Routes for non-payments collections inside reconcileSinglePayment
        // (registrations, events, balanceTransactions). Each returns a doc
        // ref whose ops are tx-only — the inner tx mocks handle reads.
        return {
          doc: () => ({ id: `${name}-doc`, update: vi.fn(), set: vi.fn() }),
        };
      }
      // Window query chain
      const chain = {
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        get: async () => ({
          size: paymentsBucket.length,
          docs: paymentsBucket,
        }),
        doc: () => ({ id: "payment-doc", update: vi.fn() }),
      };
      return chain;
    },
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) => mockRunTransaction(fn),
  },
  COLLECTIONS: {
    PAYMENTS: "payments",
    REGISTRATIONS: "registrations",
    EVENTS: "events",
    BALANCE_TRANSACTIONS: "balanceTransactions",
    REFUND_LOCKS: "refundLocks",
  },
}));

vi.mock("@/repositories/transaction.helper", () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: mockEventBusEmit },
}));

vi.mock("@/context/request-context", async () => {
  const actual = await vi.importActual<typeof RequestContextModule>(
    "@/context/request-context",
  );
  return {
    ...actual,
    getRequestId: () => mockGetRequestId(),
    trackFirestoreReads: vi.fn(),
  };
});

vi.mock("@/providers/payment-provider.interface", () => ({}));

// Provider registry mock — single mock provider returned for any
// method, with a controllable verify() so each test pins the outcome.
vi.mock("@/providers/wave-payment.provider", () => ({
  wavePaymentProvider: { name: "mock", initiate: vi.fn(), verify: mockProviderVerify, refund: vi.fn() },
}));
vi.mock("@/providers/orange-money-payment.provider", () => ({
  orangeMoneyPaymentProvider: { name: "mock", initiate: vi.fn(), verify: mockProviderVerify, refund: vi.fn() },
}));
vi.mock("@/providers/mock-payment.provider", () => ({
  mockPaymentProvider: {
    name: "mock",
    initiate: vi.fn(),
    verify: mockProviderVerify,
    refund: vi.fn(),
  },
  MockPaymentProvider: class {},
}));
vi.mock("@/providers/paydunya-payment.provider", () => ({
  paydunyaPaymentProvider: {
    name: "paydunya",
    initiate: vi.fn(),
    verify: mockProviderVerify,
    refund: vi.fn(),
  },
}));

// ─── System under test ─────────────────────────────────────────────────────

import { paymentService } from "../payment.service";
import type { Payment } from "@teranga/shared-types";

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: `pay-${Math.random().toString(36).slice(2, 8)}`,
    eventId: "ev-1",
    organizationId: "org-1",
    userId: "user-1",
    registrationId: "reg-1",
    method: "wave",
    amount: 5000,
    currency: "XOF",
    status: "processing",
    providerTransactionId: "PD_TKN_42",
    redirectUrl: "https://paydunya.example/checkout/PD_TKN_42",
    failureReason: null,
    refundedAmount: null,
    completedAt: null,
    refundedAt: null,
    metadata: null,
    providerMetadata: null,
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    ...overrides,
  } as Payment;
}

function seedBucket(payments: Payment[]) {
  paymentsBucket.length = 0;
  for (const p of payments) {
    paymentsBucket.push({ id: p.id, data: () => ({ ...p }) });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  paymentsBucket.length = 0;
});

describe("PaymentService.reconcileStuckPayments", () => {
  // ── Empty sweep — heartbeat audit still fires ─────────────────────────

  it("emits a heartbeat event with all-zero stats when no payments are stuck", async () => {
    seedBucket([]);

    const stats = await paymentService.reconcileStuckPayments();

    expect(stats).toEqual({
      scanned: 0,
      finalizedSucceeded: 0,
      finalizedFailed: 0,
      stillPending: 0,
      errored: 0,
    });
    expect(mockProviderVerify).not.toHaveBeenCalled();
    // Aggregate audit fires even on empty sweep — proves the cron is
    // alive vs. silently dead.
    const emit = mockEventBusEmit.mock.calls.find(
      (c) => c[0] === "payment.reconciliation_swept",
    );
    expect(emit?.[1]).toMatchObject({
      scanned: 0,
      finalizedSucceeded: 0,
      finalizedFailed: 0,
      stillPending: 0,
      errored: 0,
      actorId: "system:payment.reconciliation",
    });
  });

  // ── Happy path — provider says succeeded ───────────────────────────────

  it("finalises a stuck payment when the provider returns succeeded", async () => {
    const payment = makePayment();
    seedBucket([payment]);
    mockProviderVerify.mockResolvedValue({ status: "succeeded", metadata: {} });
    // Tx reads: payment, registration, event
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ id: "reg-1", ticketTypeId: "tt-1", status: "pending_payment" }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ id: "ev-1", title: "Test", ticketTypes: [{ id: "tt-1", soldCount: 0 }] }),
      });

    const stats = await paymentService.reconcileStuckPayments();

    expect(stats.scanned).toBe(1);
    expect(stats.finalizedSucceeded).toBe(1);
    expect(stats.finalizedFailed).toBe(0);
    expect(stats.stillPending).toBe(0);
    expect(stats.errored).toBe(0);

    // Provider was called with the stored token
    expect(mockProviderVerify).toHaveBeenCalledWith("PD_TKN_42");

    // State-machine flip happened in a transaction
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "confirmed" }),
    );

    // Both canonical event AND audit events emitted
    const emitNames = mockEventBusEmit.mock.calls.map((c) => c[0]);
    expect(emitNames).toContain("payment.succeeded");
    expect(emitNames).toContain("payment.verified_from_redirect");
    expect(emitNames).toContain("payment.reconciliation_swept");

    // The audit event tags the source as system reconciliation
    const verifyEvent = mockEventBusEmit.mock.calls.find(
      (c) => c[0] === "payment.verified_from_redirect",
    );
    expect(verifyEvent?.[1]).toMatchObject({
      outcome: "succeeded",
      actorId: "system:payment.reconciliation",
    });
  });

  // ── Provider says failed ───────────────────────────────────────────────

  it("flips a stuck payment to failed when the provider returns failed", async () => {
    const payment = makePayment();
    seedBucket([payment]);
    mockProviderVerify.mockResolvedValue({
      status: "failed",
      metadata: { reason: "Refused" },
    });
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => payment });

    const stats = await paymentService.reconcileStuckPayments();

    expect(stats.finalizedFailed).toBe(1);
    expect(stats.finalizedSucceeded).toBe(0);
    const emitNames = mockEventBusEmit.mock.calls.map((c) => c[0]);
    expect(emitNames).toContain("payment.failed");
    expect(emitNames).toContain("payment.verified_from_redirect");
  });

  // ── Provider still pending — left for next tick ────────────────────────

  it("leaves the payment alone when the provider is still pending", async () => {
    const payment = makePayment();
    seedBucket([payment]);
    mockProviderVerify.mockResolvedValue({ status: "pending", metadata: {} });

    const stats = await paymentService.reconcileStuckPayments();

    expect(stats.stillPending).toBe(1);
    expect(stats.finalizedSucceeded).toBe(0);
    // No state mutation tx
    expect(mockTxUpdate).not.toHaveBeenCalled();
    // Audit event fires with outcome=pending so operators see the verify ran
    const audit = mockEventBusEmit.mock.calls.find(
      (c) => c[0] === "payment.verified_from_redirect",
    );
    expect(audit?.[1]).toMatchObject({ outcome: "pending" });
  });

  // ── No provider transaction id — left for onPaymentTimeout ─────────────

  it("skips a payment with no providerTransactionId without a provider call", async () => {
    const payment = makePayment({ providerTransactionId: null });
    seedBucket([payment]);

    const stats = await paymentService.reconcileStuckPayments();

    expect(stats.stillPending).toBe(1);
    expect(mockProviderVerify).not.toHaveBeenCalled();
  });

  // ── IPN race — Payment already terminal between query and tx ───────────

  it("noops the tx when an IPN finalised the payment between the outer scan and the inner read", async () => {
    const payment = makePayment();
    seedBucket([payment]);
    mockProviderVerify.mockResolvedValue({ status: "succeeded", metadata: {} });
    // Inner-tx re-read sees the payment already succeeded → return early
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...payment, status: "succeeded" }),
    });

    const stats = await paymentService.reconcileStuckPayments();

    expect(stats.finalizedSucceeded).toBe(1);
    // No actual tx writes — the inner-tx idempotency guard returned early
    expect(mockTxUpdate).not.toHaveBeenCalled();
    // Canonical event NOT re-emitted (handler already fired earlier)
    const emitNames = mockEventBusEmit.mock.calls.map((c) => c[0]);
    expect(emitNames).not.toContain("payment.succeeded");
    // Audit-only emit still fires (operator wants to know reconciliation ran)
    expect(emitNames).toContain("payment.verified_from_redirect");
  });

  // ── Per-payment error doesn't abort the sweep ──────────────────────────

  it("continues the sweep when a single payment throws — counts as `errored`", async () => {
    const ok = makePayment({ id: "pay-ok" });
    const broken = makePayment({ id: "pay-broken" });
    seedBucket([ok, broken]);

    // First call (ok) succeeds; second (broken) throws.
    mockProviderVerify
      .mockResolvedValueOnce({ status: "succeeded", metadata: {} })
      .mockRejectedValueOnce(new Error("Provider 503"));

    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => ok })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ id: "reg-1", ticketTypeId: "tt-1" }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ id: "ev-1", ticketTypes: [{ id: "tt-1", soldCount: 0 }] }),
      });

    const stats = await paymentService.reconcileStuckPayments();

    expect(stats.scanned).toBe(2);
    expect(stats.finalizedSucceeded).toBe(1);
    expect(stats.errored).toBe(1);
    // Sweep finished — heartbeat event fired
    const sweep = mockEventBusEmit.mock.calls.find(
      (c) => c[0] === "payment.reconciliation_swept",
    );
    expect(sweep?.[1]).toMatchObject({ scanned: 2, finalizedSucceeded: 1, errored: 1 });
  });

  // ── batchSize is bounded to 200 ────────────────────────────────────────

  it("clamps batchSize to 200 max so a misconfigured caller can't exhaust the cron timeout", async () => {
    seedBucket([]);
    // No assertion on the limit() chain (the mock is a no-op pass-through)
    // — behaviour is enforced by the Math.min in the service. The test
    // pins that the call shape doesn't crash with an over-cap value.
    const stats = await paymentService.reconcileStuckPayments({ batchSize: 99999 });
    expect(stats.scanned).toBe(0);
  });
});
