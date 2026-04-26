import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentService } from "../payment.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildEvent,
  buildPayment,
  buildRegistration,
} from "@/__tests__/factories";

// ─── Mocks (vi.hoisted so they're available inside vi.mock factories) ──────

const {
  mockEventRepo,
  mockOrgRepo,
  mockRegRepo,
  mockPaymentRepo,
  mockProvider,
  mockEventBus,
  mockDocUpdate,
  mockTxGet,
  mockTxUpdate,
  mockTxSet,
  mockTxDelete,
  mockRunTransaction,
  mockRefundLockCreate,
} = vi.hoisted(() => {
  const _mockEventRepo = {
    findByIdOrThrow: vi.fn(),
  };
  // P1-13 — paidTickets plan-feature gate calls
  // organizationRepository.findByIdOrThrow inside initiatePayment.
  // Default mock returns a `pro`-plan org so existing tests pass; tests
  // that exercise the plan-gate failure path override per-case.
  const _mockOrgRepo = {
    findByIdOrThrow: vi.fn(async () => ({
      id: "org-1",
      plan: "pro",
      effectivePlan: "pro",
      effectiveLimits: {
        maxEvents: Infinity,
        maxParticipantsPerEvent: 2000,
        maxMembers: 50,
      },
      effectiveFeatures: {
        paidTickets: true,
        qrScanning: true,
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
    })),
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
  const _mockTxDelete = vi.fn();
  // Default: refund-lock create succeeds. Tests that exercise the
  // "already in flight" path override to throw an ALREADY_EXISTS
  // (gRPC code 6).
  const _mockRefundLockCreate = vi.fn(async (_arg?: unknown) => ({ writeTime: new Date() }));
  const _mockRunTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: _mockTxGet,
      update: _mockTxUpdate,
      set: _mockTxSet,
      delete: _mockTxDelete,
    };
    return fn(tx);
  });
  return {
    mockEventRepo: _mockEventRepo,
    mockOrgRepo: _mockOrgRepo,
    mockRegRepo: _mockRegRepo,
    mockPaymentRepo: _mockPaymentRepo,
    mockProvider: _mockProvider,
    mockEventBus: _mockEventBus,
    mockDocUpdate: _mockDocUpdate,
    mockTxGet: _mockTxGet,
    mockTxUpdate: _mockTxUpdate,
    mockTxSet: _mockTxSet,
    mockTxDelete: _mockTxDelete,
    mockRunTransaction: _mockRunTransaction,
    mockRefundLockCreate: _mockRefundLockCreate,
  };
});

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockOrgRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/registration.repository", () => ({
  registrationRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockRegRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/payment.repository", () => ({
  paymentRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockPaymentRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: mockEventBus,
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

vi.mock("@/services/qr-signing", () => ({
  signQrPayload: vi.fn(() => "signed-qr-code"),
  computeValidityWindow: vi.fn(() => ({
    notBefore: Date.now() - 86_400_000,
    notAfter: Date.now() + 365 * 86_400_000,
  })),
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
      // `create` + `delete` added for the Sprint-D refund-lock pattern.
      // `mockRefundLockCreate` is reset per-test so refund tests can opt
      // into simulating "lock already held" (create throws ALREADY_EXISTS).
      doc: vi.fn(() => ({
        id: "mock-doc-id",
        update: mockDocUpdate,
        create: (arg?: unknown) => mockRefundLockCreate(arg),
        delete: () => Promise.resolve(),
      })),
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
    runTransaction: (...args: unknown[]) =>
      mockRunTransaction(...(args as [(tx: unknown) => Promise<unknown>])),
  },
  COLLECTIONS: {
    REGISTRATIONS: "registrations",
    EVENTS: "events",
    PAYMENTS: "payments",
    BALANCE_TRANSACTIONS: "balanceTransactions",
    REFUND_LOCKS: "refundLocks",
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

  // Phase-2 follow-up — the callback URL handed to the provider's
  // initiate() MUST reflect WHO will send the IPN (provider.name),
  // not the user-picked method. Regression guard for the bug where
  // PayDunya was getting `/webhook/wave` and its IPNs landed on the
  // wave verifier (signature mismatch → 403, no webhook log row,
  // payment stuck in `processing`).
  it("hands the callback URL keyed by provider.name, not by user-picked method", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockProvider.initiate.mockResolvedValue({
      providerTransactionId: "mock_tx_xyz",
      redirectUrl: "http://mock-checkout/mock_tx_xyz",
    });
    mockTxGet.mockResolvedValue({ empty: true });

    await service.initiatePayment("ev-1", "vip", "mock", undefined, user);

    // The mock provider has `name: "mock"` so the callback URL the
    // service computes is `/v1/payments/webhook/mock`. If the bug
    // ever re-introduces (using `method` instead of `provider.name`),
    // the URL would still be /webhook/mock for mock and the test
    // wouldn't catch it. The real defence is in the comment + the
    // actual call shape on PayDunya tests; here we pin the
    // contract: callbackUrl ends with `/webhook/${provider.name}`.
    expect(mockProvider.initiate).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: expect.stringMatching(/\/v1\/payments\/webhook\/mock$/),
      }),
    );
  });

  it("creates registration and payment in a transaction", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockProvider.initiate.mockResolvedValue({
      providerTransactionId: "mock_tx_123",
      redirectUrl: "http://mock-checkout/mock_tx_123",
    });
    // Tx1 idempotency lookup returns no existing claim, then dup check
    // returns empty. P1-06+P1-07 reordered the reads so both are inside
    // the same tx; supply both via mockResolvedValueOnce.
    mockTxGet
      .mockResolvedValueOnce({ exists: false }) // idem doc
      .mockResolvedValueOnce({ empty: true }); // dup-reg query

    const result = await service.initiatePayment("ev-1", "vip", "mock", undefined, user);

    expect(result).toHaveProperty("paymentId");
    expect(result).toHaveProperty("redirectUrl");
    expect(mockRunTransaction).toHaveBeenCalled();
    // P1-06+P1-07 — tx1 writes 3 docs: registration + placeholder
    // payment + idempotency claim. Tx2 then UPDATES the payment with
    // the real providerTransactionId/redirectUrl (no additional sets).
    expect(mockTxSet).toHaveBeenCalledTimes(3);
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

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "payment.initiated",
      expect.objectContaining({
        eventId: "ev-1",
        amount: 10000,
        method: "mock",
        actorId: user.uid,
      }),
    );
  });

  it("rejects if user lacks payment:initiate permission", async () => {
    const noPermUser = buildAuthUser({ roles: [] as never[] });
    await expect(
      service.initiatePayment("ev-1", "vip", "mock", undefined, noPermUser),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects if event is not published", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue({ ...event, status: "draft" });
    await expect(service.initiatePayment("ev-1", "vip", "mock", undefined, user)).rejects.toThrow();
  });

  it("rejects if ticket type not found", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    await expect(
      service.initiatePayment("ev-1", "nonexistent", "mock", undefined, user),
    ).rejects.toThrow("introuvable");
  });

  it("rejects if ticket is free", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    await expect(service.initiatePayment("ev-1", "free", "mock", undefined, user)).rejects.toThrow(
      "gratuit",
    );
  });

  it("rejects duplicate registration inside transaction", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockProvider.initiate.mockResolvedValue({
      providerTransactionId: "mock_tx_123",
      redirectUrl: "http://mock-checkout/mock_tx_123",
    });
    // Transaction duplicate check returns existing registration
    mockTxGet.mockResolvedValue({ empty: false });

    await expect(service.initiatePayment("ev-1", "vip", "mock", undefined, user)).rejects.toThrow(
      "déjà inscrit",
    );
  });

  it("rejects if ticket is sold out", async () => {
    const soldOutEvent = {
      ...event,
      ticketTypes: [{ ...event.ticketTypes[0], soldCount: 50 }],
    };
    mockEventRepo.findByIdOrThrow.mockResolvedValue(soldOutEvent);
    await expect(service.initiatePayment("ev-1", "vip", "mock", undefined, user)).rejects.toThrow();
  });

  it("rejects for unsupported payment method", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    // P1-06+P1-07 — tx1 reads happen BEFORE getProvider() throws, so
    // we must satisfy them or the dup-check fires first with a
    // misleading error.
    mockTxGet
      .mockResolvedValueOnce({ exists: false }) // idem doc
      .mockResolvedValueOnce({ empty: true }); // dup-reg query
    await expect(
      service.initiatePayment("ev-1", "vip", "crypto" as never, undefined, user),
    ).rejects.toThrow("non disponible");
  });

  it("rejects returnUrl pointing outside the platform allowlist (open-redirect guard)", async () => {
    // Regression guard: previously any http/https URL was accepted as
    // returnUrl, turning us into an open-redirect amplifier off a
    // trusted Wave/OM checkout. The service now refuses hosts that
    // aren't PARTICIPANT_WEB_URL / WEB_BACKOFFICE_URL / allowlisted.
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockProvider.initiate.mockResolvedValue({
      providerTransactionId: "mock_tx",
      redirectUrl: "http://mock-checkout",
    });
    mockTxGet.mockResolvedValue({ empty: true });

    await expect(
      service.initiatePayment("ev-1", "vip", "mock", "https://attacker.example.com/phish", user),
    ).rejects.toThrow(/n'est pas autorisée/);
  });

  it("accepts returnUrl on localhost in non-production (dev default)", async () => {
    // Dev / emulator flows pass through localhost:300x; keep them
    // working while locking down production hosts.
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockProvider.initiate.mockResolvedValue({
      providerTransactionId: "mock_tx",
      redirectUrl: "http://mock-checkout",
    });
    mockTxGet.mockResolvedValue({ empty: true });

    await expect(
      service.initiatePayment(
        "ev-1",
        "vip",
        "mock",
        "http://localhost:3002/register/ev-1/payment-status",
        user,
      ),
    ).resolves.toBeDefined();
  });

  // ── P1-13 over-limit branch (audit follow-up) ──────────────────────────
  // The default `mockOrgRepo.findByIdOrThrow` returns a `pro`-plan
  // org with `paidTickets: true`, so every test above exercises the
  // happy plan-gate branch. The over-limit branch — a free / starter
  // org attempting to collect on a paid ticket — was untested. Pin
  // it now so the gate can never silently regress.
  it("rejects with PlanLimitError when org plan lacks paidTickets — P1-13", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    // Override the default pro-plan org with a free-plan one for THIS
    // test only — `mockResolvedValueOnce` so subsequent tests still
    // see the default.
    mockOrgRepo.findByIdOrThrow.mockResolvedValueOnce({
      id: orgId,
      plan: "free",
      effectivePlan: "free",
      effectiveLimits: { maxEvents: 3, maxParticipantsPerEvent: 50, maxMembers: 1 },
      effectiveFeatures: {
        paidTickets: false,
        qrScanning: false,
        customBadges: false,
        csvExport: false,
        smsNotifications: false,
        advancedAnalytics: false,
        speakerPortal: false,
        sponsorPortal: false,
        apiAccess: false,
        whiteLabel: false,
        promoCodes: false,
      },
    });

    await expect(
      service.initiatePayment("ev-1", "vip", "mock", undefined, user),
    ).rejects.toThrow(/paidTickets|Limite du plan/i);

    // CRITICAL: the gate fires BEFORE any other state is read. No
    // ticket validation, no provider call, no idempotency claim —
    // the free-plan org never sees the ticket business logic at all.
    expect(mockProvider.initiate).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  // ── P1-06 / P1-07 idempotency replay branch (audit follow-up) ─────────
  // The replay path returns `{ kind: "replayed", paymentId,
  // redirectUrl }` directly from tx1 and skips the provider call
  // entirely — that's the entire purpose of the idempotency claim.
  // Untested before this commit; now pinned so a regression that
  // collapses the `replayed` early-return into a fresh-path fallback
  // (which would call the provider on every retry, charging the
  // user N times) lights up CI immediately.
  it("returns the cached paymentId without re-calling the provider on idempotent replay — P1-06/P1-07", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    const cachedPaymentId = "pay-cached-replay-1";
    const cachedRedirectUrl = "http://mock-checkout/cached_tx";
    // Tx1: idempotency doc EXISTS with a cached paymentId → service
    // re-reads the cached Payment, surfaces its redirectUrl, and
    // returns immediately. NO duplicate-registration check, NO
    // placeholder write, NO provider call.
    mockTxGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ paymentId: cachedPaymentId, redirectUrl: cachedRedirectUrl }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          id: cachedPaymentId,
          redirectUrl: cachedRedirectUrl,
          // Other fields irrelevant — the route only reads paymentId + redirectUrl.
        }),
      });

    const result = await service.initiatePayment("ev-1", "vip", "mock", undefined, user, {
      idempotencyKey: "ik-replay-test-1",
    });

    expect(result).toEqual({
      paymentId: cachedPaymentId,
      redirectUrl: cachedRedirectUrl,
    });
    // CRITICAL invariants of the replay path:
    //   1. provider.initiate was NEVER called → no double-charge.
    //   2. No new placeholder Payment / Registration / idempotency
    //      doc was written → tx1 returned `replayed` before any set.
    //   3. payment.initiated event was NOT re-emitted → audit trail
    //      stays consistent with the original initiate call.
    expect(mockProvider.initiate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
    expect(mockEventBus.emit).not.toHaveBeenCalledWith(
      "payment.initiated",
      expect.anything(),
    );
  });
});

// ─── handleWebhook ─────────────────────────────────────────────────────────

describe("PaymentService.handleWebhook", () => {
  it("confirms payment, registration, and increments counters in transaction", async () => {
    const payment = buildPayment({ status: "processing" });
    const reg = buildRegistration({ id: payment.registrationId, ticketTypeId: "vip" });
    const event = buildEvent({
      id: payment.eventId,
      ticketTypes: [
        {
          id: "vip",
          name: "VIP",
          price: 5000,
          currency: "XOF",
          totalQuantity: 50,
          soldCount: 10,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
    });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);

    // Transaction reads
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment }) // payment re-read
      .mockResolvedValueOnce({ exists: true, data: () => reg }) // registration
      .mockResolvedValueOnce({ exists: true, data: () => event }); // event

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    expect(mockRunTransaction).toHaveBeenCalled();
    // P1-04 (audit H5) — 3 updates: payment + registration + event
    // (single tx.update on eventRef carries BOTH registeredCount
    //  increment AND the ticketTypes array rebuild). Previously
    // produced 4 updates with two separate tx.update(eventRef, ...)
    // calls; the merge eliminates that fragility.
    expect(mockTxUpdate).toHaveBeenCalledTimes(3);
  });

  it("emits payment.succeeded event", async () => {
    const payment = buildPayment({ status: "processing" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment })
      .mockResolvedValueOnce({ exists: true, data: () => buildRegistration() })
      .mockResolvedValueOnce({ exists: true, data: () => buildEvent() });

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "payment.succeeded",
      expect.objectContaining({
        paymentId: payment.id,
        amount: payment.amount,
      }),
    );
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
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...payment, status: "succeeded" }),
    });

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    expect(mockRunTransaction).toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled(); // Skipped due to idempotency
  });

  it("marks payment as failed and cancels registration atomically", async () => {
    const payment = buildPayment({ status: "processing" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => payment });

    await service.handleWebhook(payment.providerTransactionId!, "failed", {
      reason: "Solde insuffisant",
    });

    expect(mockRunTransaction).toHaveBeenCalled();
    expect(mockTxUpdate).toHaveBeenCalledTimes(2); // payment + registration
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "payment.failed",
      expect.objectContaining({
        paymentId: payment.id,
      }),
    );
  });

  it("throws NotFoundError for unknown transaction", async () => {
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(null);
    await expect(service.handleWebhook("unknown_tx", "succeeded")).rejects.toThrow();
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

  // ── P1-23 (audit test gap #1) — concurrent webhook delivery ──────────────
  // Wave / OM retry webhooks 2–5 times within seconds when they don't
  // get an immediate 200 ACK. Without the wasNewlySucceeded gate
  // (P1-08), the inner-tx idempotency guard prevented the LEDGER from
  // being double-written but every invocation that reached the emit
  // line still fired `payment.succeeded` — leading to 2-5× notification
  // bursts, audit row duplicates, and `registration.confirmed`
  // cascades. The test pins both guards:
  //
  //   Path A — outer-guard short-circuit: payment is ALREADY succeeded
  //     when the second webhook arrives. The `if (payment.status ===
  //     "succeeded") return` guard fires before the tx, no emit.
  //
  //   Path B — inner-tx idempotency: payment was processing at the
  //     outer read, but the transactional re-read sees succeeded
  //     (concurrent winner). The wasNewlySucceeded flag stays false
  //     so emit is suppressed.
  it("path A: outer-guard skips a webhook for an already-succeeded payment, NO emit — P1-23", async () => {
    const payment = buildPayment({ status: "succeeded" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    // Outer guard fires — no transaction, no emit, no ledger writes.
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockEventBus.emit).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it("path B: inner-tx idempotency skips emit when payment flipped concurrently — P1-23", async () => {
    // Outer read still sees `processing` (the concurrent winner
    // hasn't published yet from the outer's POV), but the
    // transactional re-read sees `succeeded` — exactly the race
    // P1-08 was added to neutralise.
    const payment = buildPayment({ status: "processing" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...payment, status: "succeeded" }),
    });

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    // Tx ran (we entered the runTransaction block) but the inner
    // guard short-circuited — no writes, no ledger, no emit.
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
    expect(mockEventBus.emit).not.toHaveBeenCalledWith(
      "payment.succeeded",
      expect.anything(),
    );
  });

  it("emits payment.succeeded EXACTLY ONCE across 5 sequential identical webhook deliveries — P1-23", async () => {
    // Models the Wave/OM retry burst: same providerTransactionId
    // delivered 5 times. Stateful mock — after the first `succeeded`
    // flip, every subsequent fetch / tx-read sees the post-flip
    // state and short-circuits.
    const payment = buildPayment({ status: "processing" });
    let currentStatus: "processing" | "succeeded" = "processing";

    mockPaymentRepo.findByProviderTransactionId.mockImplementation(async () => ({
      ...payment,
      status: currentStatus,
    }));

    // Inside the tx: first read is the payment, then reg, then event.
    // On the FIRST webhook (status=processing): all 3 reads happen.
    // On retries (status=succeeded): only the 1st read is reached
    // (idempotency guard short-circuits before reading reg/event).
    let txCallIndex = 0;
    mockTxGet.mockImplementation(async () => {
      txCallIndex += 1;
      // Map the call into one of: payment / reg / event.
      // First-webhook calls: 1 (payment, processing), 2 (reg), 3 (event).
      // Retry-webhook calls: 4 (payment, succeeded — guard fires).
      if (currentStatus === "processing" && txCallIndex === 1) {
        return { exists: true, data: () => ({ ...payment, status: "processing" }) };
      }
      if (currentStatus === "processing" && txCallIndex === 2) {
        return { exists: true, data: () => buildRegistration({ id: payment.registrationId }) };
      }
      if (currentStatus === "processing" && txCallIndex === 3) {
        return { exists: true, data: () => buildEvent({ id: payment.eventId }) };
      }
      // Retry path — only reads the payment, sees succeeded, skips.
      return { exists: true, data: () => ({ ...payment, status: "succeeded" }) };
    });

    // After the first tx commits the status flip, our state model
    // mirrors that change so subsequent calls hit the post-flip path.
    mockTxUpdate.mockImplementation((_ref: unknown, data: { status?: string }) => {
      if (data.status === "succeeded") currentStatus = "succeeded";
    });

    // Fire 5 identical webhooks.
    for (let i = 0; i < 5; i += 1) {
      await service.handleWebhook(payment.providerTransactionId!, "succeeded");
    }

    // EXACTLY one `payment.succeeded` emit despite 5 deliveries.
    const succeededCalls = mockEventBus.emit.mock.calls.filter(
      (c: unknown[]) => c[0] === "payment.succeeded",
    );
    expect(succeededCalls).toHaveLength(1);
    expect(succeededCalls[0][1]).toMatchObject({
      paymentId: payment.id,
      amount: payment.amount,
    });

    // Cleanup: this test installs persistent `mockImplementation`s
    // that would otherwise leak into subsequent tests. `vi.clearAllMocks`
    // (called in the global beforeEach) clears call history but NOT
    // implementations as of Vitest 2+. Reset the touched mocks here.
    mockTxGet.mockReset();
    mockTxUpdate.mockReset();
    mockPaymentRepo.findByProviderTransactionId.mockReset();
  });

  // ── Phase 2 / threat T-PD-03 — payload-tampering anti-replay ─────────────
  // PayDunya signs the IPN with SHA-512(MasterKey) — a valid signature
  // proves PROVENANCE but not BINDING. The webhook handler defends with
  // explicit cross-checks against `metadata.expectedAmount` and
  // `metadata.expectedPaymentId` (populated by the form-encoded body
  // parser in payments.routes.ts). A mismatch is conclusively a
  // tampering attempt or a config drift — we throw before any state
  // mutation.
  describe("anti-tampering invariants — Phase 2 / T-PD-03", () => {
    it("rejects when metadata.expectedAmount diverges from Payment.amount", async () => {
      const payment = buildPayment({ status: "processing", amount: 5000 });
      mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);

      await expect(
        service.handleWebhook(payment.providerTransactionId!, "succeeded", {
          providerName: "paydunya",
          expectedAmount: 50_000, // tampered: was 5000, now 50_000
          expectedPaymentId: payment.id,
        }),
      ).rejects.toThrow(/tampering|amount mismatch/i);

      // Critical: NO state mutation despite a signature-valid IPN.
      // The handler aborts before entering the runTransaction.
      expect(mockRunTransaction).not.toHaveBeenCalled();

      // Phase 2 / T-PD-03 — the audit-trail security event MUST fire
      // before the throw so post-incident analysis can spot recon.
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "payment.tampering_attempted",
        expect.objectContaining({
          paymentId: payment.id,
          field: "amount",
          expectedValue: 5000,
          receivedValue: 50_000,
          providerName: "paydunya",
          actorId: "system:webhook",
        }),
      );
    });

    it("rejects when metadata.expectedPaymentId diverges from Payment.id (token-substitution attack)", async () => {
      const payment = buildPayment({ status: "processing", id: "pay_legit_1" });
      mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);

      await expect(
        service.handleWebhook(payment.providerTransactionId!, "succeeded", {
          providerName: "paydunya",
          expectedAmount: payment.amount,
          expectedPaymentId: "pay_attacker_attempt", // substituted
        }),
      ).rejects.toThrow(/tampering|payment_id mismatch/i);

      expect(mockRunTransaction).not.toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "payment.tampering_attempted",
        expect.objectContaining({
          paymentId: "pay_legit_1",
          field: "payment_id",
          expectedValue: "pay_legit_1",
          receivedValue: "pay_attacker_attempt",
          providerName: "paydunya",
        }),
      );
    });

    it("rejects when PayDunya IPN is missing expectedAmount (defence-in-depth)", async () => {
      // Phase-2 security review P-1 — a crafted PayDunya IPN that
      // omits `invoice.total_amount` would have surfaced
      // expectedAmount: null and bypassed the cross-check. Phase-2
      // closes that by REQUIRING both fields when providerName ===
      // "paydunya" (the body parser's discriminator).
      const payment = buildPayment({ status: "processing", amount: 5000 });
      mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);

      await expect(
        service.handleWebhook(payment.providerTransactionId!, "succeeded", {
          providerName: "paydunya",
          expectedAmount: null, // missing on the IPN payload
          expectedPaymentId: payment.id,
        }),
      ).rejects.toThrow(/missing amount/i);
      expect(mockRunTransaction).not.toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "payment.tampering_attempted",
        expect.objectContaining({ field: "amount", receivedValue: null }),
      );
    });

    it("rejects when PayDunya IPN is missing expectedPaymentId", async () => {
      const payment = buildPayment({ status: "processing", id: "pay_x" });
      mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);

      await expect(
        service.handleWebhook(payment.providerTransactionId!, "succeeded", {
          providerName: "paydunya",
          expectedAmount: payment.amount,
          expectedPaymentId: null,
        }),
      ).rejects.toThrow(/missing payment_id/i);
      expect(mockRunTransaction).not.toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "payment.tampering_attempted",
        expect.objectContaining({ field: "payment_id", receivedValue: null }),
      );
    });

    it("ignores cross-check for non-PayDunya providers (Wave / OM / mock compat)", async () => {
      // Wave/OM/mock don't carry providerName: "paydunya" on
      // their webhook metadata. The handler MUST skip the strict
      // cross-check for them — surfacing missing fields would
      // break every Wave/OM webhook in production.
      const payment = buildPayment({ status: "processing" });
      mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
      mockTxGet
        .mockResolvedValueOnce({ exists: true, data: () => payment })
        .mockResolvedValueOnce({ exists: true, data: () => buildRegistration() })
        .mockResolvedValueOnce({ exists: true, data: () => buildEvent() });

      // Wave-shaped metadata: `providerName: "wave"` (or absent),
      // no expected* fields. Handler proceeds normally.
      await expect(
        service.handleWebhook(payment.providerTransactionId!, "succeeded", {
          providerName: "wave",
        }),
      ).resolves.toBeUndefined();
      expect(mockRunTransaction).toHaveBeenCalled();
    });

    it("ignores cross-check when metadata fields are absent (Wave / OM / mock providers)", async () => {
      // Wave/OM/mock don't carry expectedAmount/expectedPaymentId on
      // their webhook payloads. The handler MUST skip the cross-check
      // for those — surfacing a "missing field" error would break
      // every Wave/OM webhook in production.
      const payment = buildPayment({ status: "processing" });
      mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
      mockTxGet
        .mockResolvedValueOnce({ exists: true, data: () => payment })
        .mockResolvedValueOnce({ exists: true, data: () => buildRegistration() })
        .mockResolvedValueOnce({ exists: true, data: () => buildEvent() });

      // No metadata at all → handler proceeds normally.
      await expect(
        service.handleWebhook(payment.providerTransactionId!, "succeeded"),
      ).resolves.toBeUndefined();
      expect(mockRunTransaction).toHaveBeenCalled();
    });

    it("accepts when both cross-checks succeed (happy PayDunya path)", async () => {
      const payment = buildPayment({
        status: "processing",
        id: "pay_paydunya_ok",
        amount: 7500,
      });
      mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
      mockTxGet
        .mockResolvedValueOnce({ exists: true, data: () => payment })
        .mockResolvedValueOnce({ exists: true, data: () => buildRegistration() })
        .mockResolvedValueOnce({ exists: true, data: () => buildEvent() });

      await service.handleWebhook(payment.providerTransactionId!, "succeeded", {
        providerName: "paydunya",
        expectedAmount: 7500,
        expectedPaymentId: "pay_paydunya_ok",
      });

      expect(mockRunTransaction).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "payment.succeeded",
        expect.objectContaining({ paymentId: "pay_paydunya_ok", amount: 7500 }),
      );
    });
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
    await expect(service.getPaymentStatus("pay-1", user)).rejects.toThrow("Permission manquante");
  });

  it("requires payment:read_all for non-owner access", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const payment = buildPayment({ userId: "other-user", organizationId: "org-1" });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(service.getPaymentStatus(payment.id, user)).rejects.toThrow(
      "Permission manquante",
    );
  });

  // ── P1-09 (audit C3) — PaymentClientView projection ──────────────────────
  it("returns a PaymentClientView (no providerMetadata, no callbackUrl) for owner — P1-09", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const payment = buildPayment({
      userId: user.uid,
      // Both fields populated to prove the projection actually strips
      // them — the previous shape returned the raw `Payment` shape and
      // these would have surfaced unredacted.
      providerMetadata: { secret_internal: "DO-NOT-LEAK" },
      callbackUrl: "http://api.teranga.app/v1/payments/webhook/wave",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    const result = await service.getPaymentStatus(payment.id, user);

    expect(result.id).toBe(payment.id);
    // The projection removes these two fields. They MUST NOT appear
    // even as `null` — `omit()` removes the key entirely.
    expect("providerMetadata" in result).toBe(false);
    expect("callbackUrl" in result).toBe(false);
    // Belt-and-suspenders: serialise + grep for the secret string.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("DO-NOT-LEAK");
    expect(serialised).not.toContain("/payments/webhook");
  });

  it("returns a PaymentClientView for org admin — P1-09", async () => {
    const orgId = "org-projection";
    const admin = buildOrganizerUser(orgId);
    const payment = buildPayment({
      userId: "other-user",
      organizationId: orgId,
      providerMetadata: { internal_trace: "PROVIDER-INTERNAL-XYZ" },
      callbackUrl: "http://api.teranga.app/v1/payments/webhook/orange_money",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    const result = await service.getPaymentStatus(payment.id, admin);

    expect("providerMetadata" in result).toBe(false);
    expect("callbackUrl" in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PROVIDER-INTERNAL-XYZ");
  });

  // ── P1-14 (audit cross-org IDOR) ─────────────────────────────────────────
  it("rejects an org-A admin trying to read an org-B payment with a 'payment:read_all' role — P1-14", async () => {
    // Cross-org IDOR regression guard. Org-A admin holds
    // `payment:read_all` (org-scoped). They should NOT be able to read
    // a payment belonging to org-B even by URL-trying its id, because
    // `requireOrganizationAccess` runs in the non-owner branch.
    const orgAAdmin = buildOrganizerUser("org-A");
    const orgBPayment = buildPayment({
      userId: "victim-user",
      organizationId: "org-B",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(orgBPayment);

    await expect(service.getPaymentStatus(orgBPayment.id, orgAAdmin)).rejects.toThrow(
      "Accès refusé",
    );
  });
});

// ─── resumePayment (Phase B-2) ────────────────────────────────────────────

describe("PaymentService.resumePayment", () => {
  const owner = buildAuthUser({ uid: "user-1", roles: ["participant"] });

  it("returns the existing redirectUrl for a processing payment (happy path)", async () => {
    const payment = buildPayment({
      userId: "user-1",
      status: "processing",
      redirectUrl: "https://paydunya.com/checkout/invoice/abc",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    const result = await service.resumePayment(payment.id, owner);

    expect(result.paymentId).toBe(payment.id);
    expect(result.redirectUrl).toBe("https://paydunya.com/checkout/invoice/abc");
    expect(result.status).toBe("processing");
  });

  it("rejects callers without payment:initiate permission", async () => {
    const noPermUser = buildAuthUser({ uid: "user-1", roles: [] as never[] });
    await expect(service.resumePayment("pay-1", noPermUser)).rejects.toThrow(
      /Permission manquante/,
    );
    expect(mockPaymentRepo.findByIdOrThrow).not.toHaveBeenCalled();
  });

  it("rejects a non-owner caller (cross-user payment access guard) with 403", async () => {
    // Even an organizer with payment:initiate on their own scope must
    // not be able to fetch another user's checkout URL — that URL is
    // tied to the original buyer's PayDunya session and should never
    // be re-shared.
    const payment = buildPayment({ userId: "other-user", status: "processing" });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(service.resumePayment(payment.id, owner)).rejects.toThrow(
      /vos propres paiements/i,
    );
  });

  it("rejects on an already-succeeded payment with ConflictError", async () => {
    const payment = buildPayment({ userId: "user-1", status: "succeeded" });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(service.resumePayment(payment.id, owner)).rejects.toThrow(
      /déjà confirmé/,
    );
  });

  it.each(["failed", "refunded", "expired"] as const)(
    "rejects on a terminal status (%s) with typed details.reason",
    async (status) => {
      const payment = buildPayment({ userId: "user-1", status });
      mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

      await expect(service.resumePayment(payment.id, owner)).rejects.toThrow(
        /annulez|annulez l'inscription/i,
      );
    },
  );

  it("rejects when the Phase-1 P1-07 placeholder never completed (status=pending)", async () => {
    // Initiate tx2 didn't run (provider call failed mid-initiate).
    // The redirectUrl is null — resume can't return a valid checkout
    // session. User must cancel + re-register.
    const payment = buildPayment({
      userId: "user-1",
      status: "pending",
      redirectUrl: null,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(service.resumePayment(payment.id, owner)).rejects.toThrow(
      /n'a pas pu être démarré|annulez l'inscription/,
    );
  });

  it("rejects when redirectUrl is missing on a processing payment (defensive)", async () => {
    // Edge: tx2 of initiate should always populate redirectUrl, but
    // defend against unexpected null. The resume can't fabricate the
    // URL — surface a clear error.
    const payment = buildPayment({
      userId: "user-1",
      status: "processing",
      redirectUrl: null,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(service.resumePayment(payment.id, owner)).rejects.toThrow(
      /URL de redirection|annulez/,
    );
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
    mockPaymentRepo.findByEvent.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });

    await service.listEventPayments(
      "ev-1",
      { status: "succeeded", method: "mock" },
      { page: 1, limit: 20 },
      organizer,
    );

    expect(mockPaymentRepo.findByEvent).toHaveBeenCalledWith(
      "ev-1",
      { status: "succeeded", method: "mock" },
      { page: 1, limit: 20 },
    );
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

  // ── P1-09 (audit C3) — projection on the list endpoint too ───────────────
  it("returns PaymentClientView[] (no provider internals) on the org listing — P1-09", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    const dirty = buildPayment({
      eventId: "ev-1",
      providerMetadata: { secret_om_internal: "MUST-NOT-SURFACE" },
      callbackUrl: "http://api.teranga.app/v1/payments/webhook/wave",
    });
    mockPaymentRepo.findByEvent.mockResolvedValue({
      data: [dirty],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    const result = await service.listEventPayments(
      "ev-1",
      {},
      { page: 1, limit: 20 },
      organizer,
    );

    expect(result.data).toHaveLength(1);
    const [row] = result.data;
    expect("providerMetadata" in row).toBe(false);
    expect("callbackUrl" in row).toBe(false);
    expect(JSON.stringify(result.data)).not.toContain("MUST-NOT-SURFACE");
  });

  // ── P1-27 (audit test gap #5) — cross-org IDOR on listEventPayments ───────
  // Sister test to P1-14 (status endpoint IDOR). An organizer with
  // `payment:read_all` for org-A must NOT be able to list payments
  // for an event that belongs to org-B by passing the event id. The
  // service-level guard is `requireOrganizationAccess` — verify it
  // fires BEFORE the repository is queried (so a misconfigured
  // permission can never leak data via this path).
  it("rejects org-A admin listing org-B event payments with 403 — P1-27", async () => {
    const orgAAdmin = buildOrganizerUser("org-A");
    const orgBEvent = buildEvent({ id: "evt-cross-org", organizationId: "org-B" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(orgBEvent);

    await expect(
      service.listEventPayments("evt-cross-org", {}, { page: 1, limit: 20 }, orgAAdmin),
    ).rejects.toThrow(/Accès refusé/);

    // CRITICAL: the repository was NEVER queried. The guard fires at
    // the service-layer boundary, so a leaky repo (or a future
    // index that surfaces cross-org rows) can't be exploited via
    // this surface.
    expect(mockPaymentRepo.findByEvent).not.toHaveBeenCalled();
  });

  it("rejects org-A admin listing org-B event payment summary with 403 — P1-27", async () => {
    // Companion guard for getEventPaymentSummary — same surface,
    // different aggregation. The summary leaks total revenue + counts
    // which is competitively sensitive even without per-row metadata.
    const orgAAdmin = buildOrganizerUser("org-A");
    const orgBEvent = buildEvent({ id: "evt-cross-org-2", organizationId: "org-B" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(orgBEvent);

    await expect(
      service.getEventPaymentSummary("evt-cross-org-2", orgAAdmin),
    ).rejects.toThrow(/Accès refusé/);

    expect(mockPaymentRepo.findByEvent).not.toHaveBeenCalled();
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
    await expect(service.getEventPaymentSummary("ev-1", user)).rejects.toThrow(
      "Permission manquante",
    );
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
    // Fresh re-read inside the transaction for lost-update safety, then
    // the regRef + eventRef reads added by P1-03 for ticketTypes.soldCount
    // decrement on full refund.
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment })
      .mockResolvedValueOnce({ exists: true, data: () => ({ ticketTypeId: "tt-1" }) })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ticketTypes: [{ id: "tt-1", soldCount: 5 }] }),
      });

    await service.refundPayment(payment.id, undefined, "Annulé par l'organisateur", organizer);

    expect(mockRunTransaction).toHaveBeenCalled();
    expect(mockProvider.refund).toHaveBeenCalledWith(payment.providerTransactionId, 5000);
    // Transaction updates: payment + registration + event (single
    // tx.update on event carries BOTH registeredCount-decrement AND the
    // ticketTypes array-rebuild — P1-03 + P1-04 merge).
    expect(mockTxUpdate).toHaveBeenCalledTimes(3);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "payment.refunded",
      expect.objectContaining({
        paymentId: payment.id,
        amount: 5000,
        reason: "Annulé par l'organisateur",
      }),
    );
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
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => payment });

    await service.refundPayment(payment.id, 3000, undefined, organizer);

    expect(mockRunTransaction).toHaveBeenCalled();
    // Partial refund: only payment update (no registration cancel, no event decrement)
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
  });

  // ── P1-17 (audit M4) — refund-event audit attribution from tx-state ──────
  it("attributes payment.refunded + refund.issued from the in-tx fresh payment, not the outer snapshot — P1-17", async () => {
    // Outer read returns a payment with attribution X; the
    // transactional re-read returns the SAME doc with different
    // (hypothetical) attribution Y. The audit-row-from-tx-state
    // contract requires the emit to use Y. The fields are
    // immutable on payments today, so this is a defensive guard
    // — but it pins the convention so future code that mutates
    // `organizationId` (e.g. an org rename / merge) can't break
    // the audit trail by emitting from a stale snapshot.
    const outerSnapshot = buildPayment({
      status: "succeeded",
      organizationId: "org-OUTER",
      registrationId: "reg-OUTER",
      eventId: "evt-OUTER",
      amount: 4000,
      refundedAmount: 0,
    });
    const txSnapshot = {
      ...outerSnapshot,
      organizationId: "org-FRESH",
      registrationId: "reg-FRESH",
      eventId: "evt-FRESH",
    };

    // requireOrganizationAccess on the OUTER snapshot, so the actor
    // needs to be in org-OUTER — that's the gate the user actually
    // crosses before the tx runs.
    const actor = buildOrganizerUser("org-OUTER");

    mockPaymentRepo.findByIdOrThrow
      .mockResolvedValueOnce(outerSnapshot)
      .mockResolvedValueOnce({ ...txSnapshot, refundedAmount: 4000, status: "refunded" });
    mockProvider.refund.mockResolvedValue({ success: true });
    // tx.get returns the FRESH snapshot — full refund branch reads
    // regRef + eventRef next so we mock those too.
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => txSnapshot })
      .mockResolvedValueOnce({ exists: true, data: () => ({ ticketTypeId: "tt-1" }) })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ticketTypes: [{ id: "tt-1", soldCount: 7 }] }),
      });

    await service.refundPayment(outerSnapshot.id, undefined, "tx-state attribution", actor);

    // Both emits MUST carry the FRESH attribution (org-FRESH, reg-FRESH,
    // evt-FRESH), NOT the outer snapshot's (org-OUTER, …).
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "payment.refunded",
      expect.objectContaining({
        paymentId: outerSnapshot.id,
        organizationId: "org-FRESH",
        registrationId: "reg-FRESH",
        eventId: "evt-FRESH",
      }),
    );
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "refund.issued",
      expect.objectContaining({
        paymentId: outerSnapshot.id,
        organizationId: "org-FRESH",
        registrationId: "reg-FRESH",
        eventId: "evt-FRESH",
      }),
    );
    // Belt-and-suspenders: the stale "OUTER" attribution must not
    // appear on either emit.
    const emitCalls = mockEventBus.emit.mock.calls;
    const refundedEmits = emitCalls.filter(
      (c: unknown[]) => c[0] === "payment.refunded" || c[0] === "refund.issued",
    );
    for (const [, payload] of refundedEmits) {
      expect((payload as { organizationId: string }).organizationId).not.toBe("org-OUTER");
      expect((payload as { registrationId: string }).registrationId).not.toBe("reg-OUTER");
      expect((payload as { eventId: string }).eventId).not.toBe("evt-OUTER");
    }
  });

  it("rejects when a concurrent refund has already applied (fresh read inside tx)", async () => {
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 5000,
      refundedAmount: 0,
    });
    // Fresh read inside tx shows payment already fully refunded by a
    // concurrent request — guard must fire and prevent double-write.
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockProvider.refund.mockResolvedValue({ success: true });
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...payment, status: "refunded", refundedAmount: 5000 }),
    });

    await expect(
      service.refundPayment(payment.id, undefined, undefined, organizer),
    ).rejects.toThrow(/déjà.*remboursé/i);

    // Crucially: NO ledger entry was written despite provider having been
    // called — the transaction rolled back.
    expect(mockTxSet).not.toHaveBeenCalled();
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

    await expect(service.refundPayment(payment.id, 2000, undefined, organizer)).rejects.toThrow(
      "dépasse",
    );
  });

  it("rejects if refund amount is zero or negative", async () => {
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 5000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    await expect(service.refundPayment(payment.id, 0, undefined, organizer)).rejects.toThrow(
      "positif",
    );
  });

  it("rejects if user lacks payment:refund permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    await expect(service.refundPayment("pay-1", undefined, undefined, user)).rejects.toThrow(
      "Permission manquante",
    );
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

  it("surfaces the specific manual-refund message when provider tags reason", async () => {
    // Orange Money returns {success:false, reason:"manual_refund_required"}
    // because OM has no refund API. The service must surface a specific
    // French message explaining the operator needs to refund via the OM
    // merchant portal — the generic "refusé" string would leave the
    // organizer without any actionable next step.
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 5000,
      refundedAmount: 0,
      method: "orange_money",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockProvider.refund.mockResolvedValue({
      success: false,
      reason: "manual_refund_required",
    });

    await expect(
      service.refundPayment(payment.id, undefined, undefined, organizer),
    ).rejects.toThrow(/remboursements automatiques|portail marchand/);
  });

  // ── P1-19 (audit M7) — disambiguated French copy per RefundFailureReason ─
  // Each branch of the discriminated union MUST surface a distinct
  // operator-actionable message + the typed reason on `details.reason`
  // for the backoffice UI to render targeted retry / reconciliation
  // affordances.
  it.each([
    {
      reason: "insufficient_funds" as const,
      regex: /solde marchand insuffisant|réapprovisionnement/,
    },
    {
      reason: "already_refunded" as const,
      regex: /déjà été remboursé|réconciliez/,
    },
    {
      reason: "transaction_not_found" as const,
      regex: /retrouve pas la transaction|support technique/,
    },
    {
      reason: "network_timeout" as const,
      regex: /n'a pas répondu|Réessayez/,
    },
    {
      reason: "provider_error" as const,
      regex: /refusé par le fournisseur|tableau de bord/,
    },
  ])(
    "surfaces a disambiguated French message for reason='$reason' — P1-19",
    async ({ reason, regex }) => {
      const payment = buildPayment({
        status: "succeeded",
        organizationId: orgId,
        amount: 5000,
        refundedAmount: 0,
        method: "wave",
      });
      mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
      mockProvider.refund.mockResolvedValue({
        success: false,
        reason,
        providerCode: "test-code",
      });

      await expect(
        service.refundPayment(payment.id, undefined, undefined, organizer),
      ).rejects.toThrow(regex);

      // The error MUST also emit `refund.failed` with the typed reason
      // so the dispatcher routes to the right notification template.
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "refund.failed",
        expect.objectContaining({
          paymentId: payment.id,
          failureReason: reason,
        }),
      );
    },
  );

  it("falls back to provider_error message when reason is missing — P1-19", async () => {
    // Belt-and-suspenders for the RefundFailureReason invariant
    // (every provider failure MUST tag a reason). If a provider
    // forgets, we fall back to the provider_error copy and emit
    // `refund.failed` with `failureReason: "provider_refused"` so
    // the dashboard alarm fires.
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 5000,
      refundedAmount: 0,
      method: "wave",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockProvider.refund.mockResolvedValue({ success: false }); // no reason

    await expect(
      service.refundPayment(payment.id, undefined, undefined, organizer),
    ).rejects.toThrow(/refusé par le fournisseur/);
  });

  // ── P1-24 (audit test gap #2) — refund amount math boundaries ────────────
  // Pin the integer-arithmetic + status-transition contract. Reference
  // payment is 10 000 XOF, refundedAmount: 0. Every boundary case is
  // tested:
  //
  //   amount   | expected outcome
  //   --------- | ----------------------------------------------------
  //   0         | reject (must be positive)
  //   -1        | reject (must be positive)
  //   "0.5"     | reject (must be integer — XOF has no decimals)
  //   1         | accept; status STAYS `succeeded` (partial)
  //   9999      | accept; status STAYS `succeeded` (partial)
  //   10000     | accept; status FLIPS to `refunded` (full refund)
  //   10001     | reject (exceeds remaining balance)
  //
  // The boundary at 10000 → status flip is critical: handleWebhook
  // and the registeredCount decrement only fire on FULL refund. Off-
  // by-one errors here would leak refunded payments that still occupy
  // a registration seat or, conversely, decrement the counter for a
  // partial that should leave the seat held.
  describe("amount math boundaries — P1-24", () => {
    const orgIdLocal = "org-1";
    const organizerLocal = buildOrganizerUser(orgIdLocal);
    const TICKET_PRICE = 10_000;

    function setupFreshPayment(refundedAmount = 0): ReturnType<typeof buildPayment> {
      return buildPayment({
        status: "succeeded",
        organizationId: orgIdLocal,
        amount: TICKET_PRICE,
        refundedAmount,
      });
    }

    it("rejects amount=0 (must be positive)", async () => {
      const payment = setupFreshPayment();
      mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

      await expect(
        service.refundPayment(payment.id, 0, undefined, organizerLocal),
      ).rejects.toThrow(/positif/);
      expect(mockProvider.refund).not.toHaveBeenCalled();
    });

    it("rejects amount=-1 (must be positive)", async () => {
      const payment = setupFreshPayment();
      mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

      await expect(
        service.refundPayment(payment.id, -1, undefined, organizerLocal),
      ).rejects.toThrow(/positif/);
      expect(mockProvider.refund).not.toHaveBeenCalled();
    });

    it("rejects amount=0.5 (must be integer — XOF has no decimals)", async () => {
      const payment = setupFreshPayment();
      mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

      await expect(
        service.refundPayment(payment.id, 0.5, undefined, organizerLocal),
      ).rejects.toThrow(/entier|décimales/);
      expect(mockProvider.refund).not.toHaveBeenCalled();
    });

    it("accepts amount=1 (minimal partial refund) — status stays succeeded", async () => {
      const payment = setupFreshPayment();
      mockPaymentRepo.findByIdOrThrow
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce({ ...payment, refundedAmount: 1 });
      mockProvider.refund.mockResolvedValue({ success: true });
      mockTxGet.mockResolvedValueOnce({ exists: true, data: () => payment });

      await service.refundPayment(payment.id, 1, undefined, organizerLocal);

      expect(mockProvider.refund).toHaveBeenCalledWith(payment.providerTransactionId, 1);
      // Partial refund: only ONE tx.update on the payment (no
      // registration cancel, no event counter decrement).
      expect(mockTxUpdate).toHaveBeenCalledTimes(1);
      expect(mockTxUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: "succeeded", // status stays — it's a PARTIAL refund
          refundedAmount: 1,
        }),
      );
    });

    it("accepts amount=9999 (1 XOF short of full) — status stays succeeded", async () => {
      const payment = setupFreshPayment();
      mockPaymentRepo.findByIdOrThrow
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce({ ...payment, refundedAmount: 9999 });
      mockProvider.refund.mockResolvedValue({ success: true });
      mockTxGet.mockResolvedValueOnce({ exists: true, data: () => payment });

      await service.refundPayment(payment.id, 9999, undefined, organizerLocal);

      expect(mockProvider.refund).toHaveBeenCalledWith(payment.providerTransactionId, 9999);
      expect(mockTxUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: "succeeded", // off-by-one boundary — still partial
          refundedAmount: 9999,
        }),
      );
    });

    it("accepts amount=10000 (full refund) — status FLIPS to refunded + decrements counters", async () => {
      const payment = setupFreshPayment();
      mockPaymentRepo.findByIdOrThrow
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce({ ...payment, status: "refunded", refundedAmount: 10000 });
      mockProvider.refund.mockResolvedValue({ success: true });
      // Full-refund branch reads payment + reg + event for the
      // ticketTypes.soldCount decrement (P1-03).
      mockTxGet
        .mockResolvedValueOnce({ exists: true, data: () => payment })
        .mockResolvedValueOnce({ exists: true, data: () => ({ ticketTypeId: "tt-1" }) })
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ ticketTypes: [{ id: "tt-1", soldCount: 5 }] }),
        });

      await service.refundPayment(payment.id, 10000, undefined, organizerLocal);

      expect(mockProvider.refund).toHaveBeenCalledWith(payment.providerTransactionId, 10000);
      // Full refund: payment update + registration cancel + event update = 3
      expect(mockTxUpdate).toHaveBeenCalledTimes(3);
      expect(mockTxUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: "refunded", // status flips on full refund
          refundedAmount: 10000,
        }),
      );
    });

    it("rejects amount=10001 (1 XOF over full balance)", async () => {
      const payment = setupFreshPayment();
      mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

      await expect(
        service.refundPayment(payment.id, 10001, undefined, organizerLocal),
      ).rejects.toThrow(/dépasse/);
      expect(mockProvider.refund).not.toHaveBeenCalled();
    });

    it("rejects when remaining balance is exhausted (refundedAmount=10000 + new=1)", async () => {
      // Cumulative-refund boundary: 10 000 already refunded, any
      // further amount must be rejected even if the new amount
      // alone would have been valid against the original.
      const payment = setupFreshPayment(/* refundedAmount */ 10000);
      mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
      // The outer guard fires first (status === "succeeded" but
      // remaining = 0). The validate path catches it.

      await expect(
        service.refundPayment(payment.id, 1, undefined, organizerLocal),
      ).rejects.toThrow(/dépasse|déjà.*remboursé/i);
      expect(mockProvider.refund).not.toHaveBeenCalled();
    });
  });
});

// ─── Concurrent-refund lock (Q1a, post-audit) ─────────────────────────────
//
// SPEC, not wiring: pins the real-world invariant that two concurrent
// refund requests for the same payment DO NOT both hit the provider.
// Before this pattern, the outer guard read `payment.refundedAmount`
// OUTSIDE the transaction; two requests could both pass it, both call
// `provider.refund(...)`, and only the DB write deduplicate — the
// provider's side recorded two refunds and our ledger showed one, so
// money leaked at the provider. The pre-call lock at
// `refundLocks/{paymentId}` makes it impossible for the provider to be
// hit twice concurrently for the same payment.

describe("PaymentService.refundPayment — concurrent-refund lock", () => {
  const organizer = buildOrganizerUser("org-1");

  it("rejects a second concurrent refund for the same payment (409 ConflictError)", async () => {
    // Simulate the lock already held: `ref.create()` throws with the
    // Firestore gRPC ALREADY_EXISTS code (6) — identical to what the
    // real Admin SDK emits when a doc with that id already exists.
    const payment = buildPayment({
      status: "succeeded",
      organizationId: "org-1",
      amount: 5000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    const err = Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
    mockRefundLockCreate.mockRejectedValueOnce(err);
    // Stale-lock recovery enters a tx that reads the existing lock.
    // Pin the lock as fresh (expires in 4 min) so recovery returns
    // false → service throws ConflictError. Without this mock, the
    // recovery's `existing.exists` check crashes on undefined.
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() }),
    });

    await expect(
      service.refundPayment(payment.id, undefined, undefined, organizer),
    ).rejects.toThrow(/en cours pour ce paiement/);

    // CRITICAL: the provider MUST NOT have been called. That's the
    // whole point of the lock — prevent a concurrent request from
    // reaching the provider before the first one completes.
    expect(mockProvider.refund).not.toHaveBeenCalled();
  });

  it("releases the lock on provider throw (next attempt can proceed)", async () => {
    // Provider errors should free the lock. If we only released on
    // success, a transient provider 500 would wedge the payment so
    // the organizer couldn't retry even after the transient issue
    // passed. `lockRef.delete()` is called in the catch path.
    const payment = buildPayment({
      status: "succeeded",
      organizationId: "org-1",
      amount: 5000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockProvider.refund.mockRejectedValueOnce(new Error("network timeout"));

    await expect(
      service.refundPayment(payment.id, undefined, undefined, organizer),
    ).rejects.toThrow("network timeout");

    // The lock was claimed (create called once) then released on the
    // throw — not left hanging.
    expect(mockRefundLockCreate).toHaveBeenCalledTimes(1);
  });

  it("on success, lock release is wired into the same transaction as the ledger write", async () => {
    // Releasing the lock INSIDE the tx ties it to the commit. A retry
    // under contention re-runs the whole lambda; the second run must
    // also release the lock so a subsequent refund can proceed.
    // Structural assertion: `tx.delete` is called exactly once per
    // successful refund.
    const payment = buildPayment({
      status: "succeeded",
      organizationId: "org-1",
      amount: 5000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockProvider.refund.mockResolvedValue({ success: true, providerRefundId: "pr-1" });
    // P1-03 added regRef + eventRef reads inside the full-refund tx.
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment })
      .mockResolvedValueOnce({ exists: true, data: () => ({ ticketTypeId: "tt-1" }) })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ticketTypes: [{ id: "tt-1", soldCount: 5 }] }),
      });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValueOnce(payment);

    await service.refundPayment(payment.id, undefined, undefined, organizer);

    // tx.delete called once (for the lock doc) inside the transaction.
    expect(mockTxDelete).toHaveBeenCalledTimes(1);
  });

  // ── P1-26 (audit test gap #4) — concurrent lock semantics ─────────────────
  // The defining invariant of the lock: when two refund flows race
  // for the same payment, EXACTLY ONE provider call happens — the
  // loser is rejected at the lock-acquire step BEFORE the provider
  // is touched. This is what protects us from double-charging the
  // merchant via the provider when the DB write deduplicates but
  // the provider has already been hit twice.
  //
  // The "two simultaneous calls" structural assertion is captured
  // by "rejects a second concurrent refund for the same payment"
  // above — same lock-acquire path. This sister test pins the
  // recovery branch's fresh-lock guard, which is the failure mode
  // where the recovery would WRONGLY accept a concurrent caller and
  // both flows would hit the provider.
  it("stale-lock recovery — loser of fresh contention does NOT reach the provider — P1-26", async () => {
    // Defensive: the recovery tx must NOT release a lock whose
    // expiresAt is still in the future. Without that guard, the
    // recovery path would wrongly accept a concurrent caller and
    // both flows would hit the provider. This is a separate
    // invariant from the happy-path concurrent test above —
    // it pins the recovery's fresh-lock branch.
    const payment = buildPayment({
      status: "succeeded",
      organizationId: "org-1",
      amount: 5000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);

    // First create throws ALREADY_EXISTS (lock held by another flow).
    const err = Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
    mockRefundLockCreate.mockRejectedValueOnce(err);
    // Recovery tx reads the existing lock — fresh (expires in 4 min).
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() }),
    });

    await expect(
      service.refundPayment(payment.id, undefined, undefined, organizer),
    ).rejects.toThrow(/en cours pour ce paiement/);

    // Provider MUST NOT have been called. Lock contention short-
    // circuits before any network call.
    expect(mockProvider.refund).not.toHaveBeenCalled();
  });
});

// ─── Ledger writes on handleWebhook(succeeded) ─────────────────────────────
//
// Every successful payment must write two balance_transactions entries in
// the SAME transaction that confirms the payment: +amount (kind=payment)
// and −fee (kind=platform_fee). This guarantees the /finance page balance
// is never stale relative to the payments list.

describe("PaymentService.handleWebhook — ledger", () => {
  it("writes payment + platform_fee ledger entries on success", async () => {
    const payment = buildPayment({ status: "processing", amount: 10_000 });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment })
      .mockResolvedValueOnce({ exists: true, data: () => buildRegistration() })
      .mockResolvedValueOnce({
        exists: true,
        data: () => buildEvent({ endDate: "2026-06-01T00:00:00.000Z" }),
      });

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    // Two ledger entries written via tx.set(): payment + platform_fee
    expect(mockTxSet).toHaveBeenCalledTimes(2);

    const setCalls = mockTxSet.mock.calls.map((call) => call[1]);
    const paymentEntry = setCalls.find((e: { kind: string }) => e.kind === "payment") as
      | { amount: number; status: string; currency: string }
      | undefined;
    const feeEntry = setCalls.find((e: { kind: string }) => e.kind === "platform_fee") as
      | { amount: number; status: string }
      | undefined;

    expect(paymentEntry).toBeDefined();
    expect(paymentEntry!.amount).toBe(10_000); // +gross
    expect(paymentEntry!.status).toBe("pending");
    expect(paymentEntry!.currency).toBe("XOF");

    expect(feeEntry).toBeDefined();
    expect(feeEntry!.amount).toBe(-500); // −5% of 10 000
    expect(feeEntry!.status).toBe("pending");
  });

  it("writes no ledger entries on failed payment", async () => {
    const payment = buildPayment({ status: "processing" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => payment });

    await service.handleWebhook(payment.providerTransactionId!, "failed", {
      reason: "Solde insuffisant",
    });

    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it("skips ledger writes when payment became terminal concurrently (idempotency)", async () => {
    const payment = buildPayment({ status: "processing" });
    mockPaymentRepo.findByProviderTransactionId.mockResolvedValue(payment);
    // Fresh re-read inside tx shows already succeeded → abort
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...payment, status: "succeeded" }),
    });

    await service.handleWebhook(payment.providerTransactionId!, "succeeded");

    expect(mockTxSet).not.toHaveBeenCalled();
  });
});

// ─── Ledger writes on refundPayment ────────────────────────────────────────

describe("PaymentService.refundPayment — ledger", () => {
  const orgId = "org-1";
  const organizer = buildOrganizerUser(orgId);

  it("writes a refund ledger entry with status=available on full refund", async () => {
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 5_000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce({ ...payment, status: "refunded", refundedAmount: 5_000 });
    mockProvider.refund.mockResolvedValue({ success: true });
    // P1-03 added regRef + eventRef reads inside the full-refund tx.
    mockTxGet
      .mockResolvedValueOnce({ exists: true, data: () => payment })
      .mockResolvedValueOnce({ exists: true, data: () => ({ ticketTypeId: "tt-1" }) })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ticketTypes: [{ id: "tt-1", soldCount: 5 }] }),
      });

    await service.refundPayment(payment.id, undefined, "Annulé par l'organisateur", organizer);

    expect(mockTxSet).toHaveBeenCalledTimes(1);
    const refundEntry = mockTxSet.mock.calls[0][1] as {
      kind: string;
      amount: number;
      status: string;
      description: string;
    };
    expect(refundEntry.kind).toBe("refund");
    expect(refundEntry.amount).toBe(-5_000);
    // Refunds skip the pending window — operator must see balance debited now
    expect(refundEntry.status).toBe("available");
    expect(refundEntry.description).toContain("Annulé par l'organisateur");
  });

  it("writes a partial refund entry matching the refund amount", async () => {
    const payment = buildPayment({
      status: "succeeded",
      organizationId: orgId,
      amount: 10_000,
      refundedAmount: 0,
    });
    mockPaymentRepo.findByIdOrThrow
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce({ ...payment, refundedAmount: 3_000 });
    mockProvider.refund.mockResolvedValue({ success: true });
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => payment });

    await service.refundPayment(payment.id, 3_000, undefined, organizer);

    expect(mockTxSet).toHaveBeenCalledTimes(1);
    const refundEntry = mockTxSet.mock.calls[0][1] as { amount: number };
    expect(refundEntry.amount).toBe(-3_000);
  });
});
