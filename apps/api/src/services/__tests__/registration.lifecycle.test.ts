import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUser } from "@/__tests__/factories";
import type { Registration, Payment } from "@teranga/shared-types";

// Phase B-1 + B-3 — covers `getMyRegistrationForEvent` (look-up
// endpoint used by the participant web app to render the right CTA)
// and `cancelPending` (user-initiated cancel of a stuck pending_payment
// registration). Mock setup mirrors `registration.waitlist.test.ts`
// for consistency; we add `paymentRepository` + tx query helpers so
// `cancelPending` can resolve the linked Payment doc inside the tx.

const {
  mockRegRepo,
  mockEventRepo,
  mockPaymentRepo,
  mockPaymentTxQuery,
  mockTxGet,
  mockTxUpdate,
  mockBusEmit,
} = vi.hoisted(() => {
  const _mockPaymentTxQuery = {
    where: vi.fn(),
    limit: vi.fn(),
  };
  _mockPaymentTxQuery.where.mockReturnValue(_mockPaymentTxQuery);
  _mockPaymentTxQuery.limit.mockReturnValue(_mockPaymentTxQuery);
  return {
    mockRegRepo: {
      findByIdOrThrow: vi.fn(),
      findCurrentForUser: vi.fn(),
      ref: { doc: vi.fn((id: string) => ({ id })) },
    },
    mockEventRepo: {
      findByIdOrThrow: vi.fn(),
    },
    // Payment repository — the tx in cancelPending issues a query
    // against it (`paymentRepository.ref.where(...).limit(1)`) to
    // find the linked Payment. The mock returns a simple chain that
    // ends in a `tx.get()` resolving to a snapshot we control
    // per test.
    mockPaymentRepo: { ref: _mockPaymentTxQuery },
    mockPaymentTxQuery: _mockPaymentTxQuery,
    mockTxGet: vi.fn(),
    mockTxUpdate: vi.fn(),
    mockBusEmit: vi.fn(),
  };
});

vi.mock("@/repositories/registration.repository", () => ({
  registrationRepository: new Proxy(
    {},
    { get: (_t, prop) => (mockRegRepo as Record<string, unknown>)[prop as string] },
  ),
}));
vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    { get: (_t, prop) => (mockEventRepo as Record<string, unknown>)[prop as string] },
  ),
}));
vi.mock("@/repositories/payment.repository", () => ({
  paymentRepository: new Proxy(
    {},
    { get: (_t, prop) => (mockPaymentRepo as Record<string, unknown>)[prop as string] },
  ),
}));
vi.mock("@/repositories/transaction.helper", () => ({
  runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ get: mockTxGet, update: mockTxUpdate });
  }),
  FieldValue: {
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));
vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: mockBusEmit },
}));
vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Side-effect mocks — the service imports these but our two tested
// methods don't exercise them.
vi.mock("@/repositories/badge.repository", () => ({
  badgeRepository: { ref: { doc: vi.fn() } },
}));
vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: { findByIdOrThrow: vi.fn() },
}));
vi.mock("@/repositories/user.repository", () => ({
  userRepository: { findById: vi.fn() },
}));
vi.mock("@/repositories/sponsor.repository", () => ({
  sponsorRepository: { ref: { doc: vi.fn() } },
}));
vi.mock("@/repositories/checkin.repository", () => ({
  checkinRepository: {},
}));
vi.mock("@/repositories/checkin-lock.repository", () => ({
  checkinLockRepository: {},
}));
vi.mock("@/services/qr-signing", () => ({
  signQrV4: vi.fn(),
  computeValidityWindow: vi.fn(),
}));
vi.mock("@/services/notifications/notifications.service", () => ({
  notificationsService: { enqueue: vi.fn(), send: vi.fn() },
}));
vi.mock("@/config/firebase", () => ({
  db: { collection: vi.fn() },
  COLLECTIONS: {
    REGISTRATIONS: "registrations",
    PAYMENTS: "payments",
    EVENTS: "events",
  },
}));

import { RegistrationService } from "../registration.service";

const service = new RegistrationService();

function buildReg(overrides: Partial<Registration> = {}): Registration {
  const now = new Date().toISOString();
  return {
    id: "reg-1",
    eventId: "event-1",
    userId: "user-1",
    ticketTypeId: "ticket-vip",
    status: "pending_payment",
    qrCodeValue: "x:y:z",
    checkedInAt: null,
    checkedInBy: null,
    accessZoneId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Registration;
}

function buildPayment(overrides: Partial<Payment> = {}): Payment {
  const now = new Date().toISOString();
  return {
    id: "pay-1",
    registrationId: "reg-1",
    eventId: "event-1",
    organizationId: "org-1",
    userId: "user-1",
    amount: 5000,
    currency: "XOF",
    method: "wave",
    providerTransactionId: "tx-123",
    status: "processing",
    redirectUrl: "https://paydunya.com/checkout/invoice/abc",
    callbackUrl: "https://api/v1/payments/webhook/paydunya",
    returnUrl: "https://app/payment-status",
    providerMetadata: null,
    failureReason: null,
    refundedAmount: 0,
    initiatedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Payment;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-set the default chain return values after `clearAllMocks`
  // wiped them. `mockReturnValue` is preserved by clearAllMocks but
  // only on top-level mocks, not nested ones.
  mockPaymentTxQuery.where.mockReturnValue(mockPaymentTxQuery);
  mockPaymentTxQuery.limit.mockReturnValue(mockPaymentTxQuery);
});

// ─── getMyRegistrationForEvent (Phase B-1) ────────────────────────────────

describe("RegistrationService.getMyRegistrationForEvent", () => {
  const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });

  it("returns the user's current active registration for the event", async () => {
    const reg = buildReg({ status: "pending_payment" });
    mockRegRepo.findCurrentForUser.mockResolvedValue(reg);

    const result = await service.getMyRegistrationForEvent("event-1", user);

    expect(result).toEqual(reg);
    expect(mockRegRepo.findCurrentForUser).toHaveBeenCalledWith("event-1", "user-1");
  });

  it("returns null when no active registration exists (cancelled / never registered)", async () => {
    // Critical for the UI flow: null is a valid 200 response, not an
    // error. The frontend interprets null as "show register CTA".
    mockRegRepo.findCurrentForUser.mockResolvedValue(null);

    const result = await service.getMyRegistrationForEvent("event-1", user);

    expect(result).toBeNull();
  });

  it("rejects callers without registration:read_own permission", async () => {
    const noPermUser = buildAuthUser({ uid: "user-1", roles: [] as never[] });
    await expect(
      service.getMyRegistrationForEvent("event-1", noPermUser),
    ).rejects.toThrow(/Permission manquante/);
    // Repository must NOT be queried when the permission check fails
    // — protects against accidental enumeration of someone else's
    // registrations via the auth bypass.
    expect(mockRegRepo.findCurrentForUser).not.toHaveBeenCalled();
  });

  it("scopes the query to the AUTHENTICATED user (not a query-string-supplied uid)", async () => {
    // Defensive: ensures that even if a future refactor introduced
    // an optional `targetUserId` parameter, this method ALWAYS reads
    // the caller's own registration (matching the
    // registration:read_own permission). The query MUST receive
    // user.uid as second arg, not eventId or anything else.
    mockRegRepo.findCurrentForUser.mockResolvedValue(null);
    await service.getMyRegistrationForEvent("event-99", user);
    const [calledEventId, calledUid] = mockRegRepo.findCurrentForUser.mock.calls[0];
    expect(calledEventId).toBe("event-99");
    expect(calledUid).toBe(user.uid);
  });
});

// ─── cancelPending (Phase B-3) ────────────────────────────────────────────

describe("RegistrationService.cancelPending", () => {
  const owner = buildAuthUser({ uid: "user-1", roles: ["participant"] });

  /** Helper — set up the standard happy-path mock chain. */
  function setUpHappyPath(opts: {
    registration?: Registration;
    payment?: Payment | null;
    event?: { id: string; organizationId: string };
  } = {}) {
    const reg = opts.registration ?? buildReg({ status: "pending_payment" });
    const payment = opts.payment === undefined ? buildPayment() : opts.payment;
    const event = opts.event ?? { id: "event-1", organizationId: "org-1" };

    mockRegRepo.findByIdOrThrow.mockResolvedValue(reg);

    // Tx flow: tx.get(regRef) → fresh registration, then tx.get(payments query) → snapshot
    mockTxGet
      .mockResolvedValueOnce({
        exists: true,
        id: reg.id,
        data: () => reg,
      })
      .mockResolvedValueOnce(
        payment
          ? {
              empty: false,
              docs: [
                {
                  id: payment.id,
                  ref: { id: payment.id },
                  data: () => payment,
                },
              ],
            }
          : { empty: true, docs: [] },
      );

    // After-tx event lookup for the audit emit
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    return { reg, payment, event };
  }

  // ── Happy path ──────────────────────────────────────────────────────────
  it("flips the registration to cancelled + the linked payment to expired in one tx", async () => {
    setUpHappyPath();

    await service.cancelPending("reg-1", owner);

    // Two tx.update calls expected: one on regRef, one on paymentRef
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reg-1" }),
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pay-1" }),
      expect.objectContaining({
        status: "expired",
        failureReason: expect.stringContaining("annulé"),
      }),
    );
  });

  it("emits registration.cancelled + payment.expired AFTER the tx commits", async () => {
    setUpHappyPath();

    await service.cancelPending("reg-1", owner);

    expect(mockBusEmit).toHaveBeenCalledWith(
      "registration.cancelled",
      expect.objectContaining({
        registrationId: "reg-1",
        eventId: "event-1",
        organizationId: "org-1",
        actorId: owner.uid,
      }),
    );
    expect(mockBusEmit).toHaveBeenCalledWith(
      "payment.expired",
      expect.objectContaining({
        paymentId: "pay-1",
        registrationId: "reg-1",
        organizationId: "org-1",
        reason: "user_cancelled",
      }),
    );
  });

  it("handles the no-linked-payment case gracefully (registration cancelled, no payment.expired emit)", async () => {
    // Edge: tx2 of initiate failed, so the placeholder Payment was
    // never finalized. cancelPending must still flip the registration
    // and avoid emitting payment.expired (no Payment touched).
    setUpHappyPath({ payment: null });

    await service.cancelPending("reg-1", owner);

    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockBusEmit).toHaveBeenCalledWith("registration.cancelled", expect.any(Object));
    expect(mockBusEmit).not.toHaveBeenCalledWith("payment.expired", expect.any(Object));
  });

  // ── Permission denial (cross-user IDOR guard) ──────────────────────────
  it("rejects a caller who isn't the registration owner with 403", async () => {
    const reg = buildReg({ userId: "other-user", status: "pending_payment" });
    mockRegRepo.findByIdOrThrow.mockResolvedValue(reg);

    await expect(service.cancelPending("reg-1", owner)).rejects.toThrow(
      /vos propres inscriptions|Permissions insuffisantes/i,
    );
    // No state mutation
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  // ── Invalid status — registration is not in pending_payment ─────────────
  it("rejects when the registration is in a status other than pending_payment", async () => {
    // confirmed → must go through the regular cancel() path, not this one
    const reg = buildReg({ status: "confirmed" });
    mockRegRepo.findByIdOrThrow.mockResolvedValue(reg);

    await expect(service.cancelPending("reg-1", owner)).rejects.toThrow(
      /attente de paiement/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the registration was already cancelled (idempotency at outer guard)", async () => {
    const reg = buildReg({ status: "cancelled" });
    mockRegRepo.findByIdOrThrow.mockResolvedValue(reg);

    await expect(service.cancelPending("reg-1", owner)).rejects.toThrow(
      /attente de paiement/,
    );
  });

  // ── Race-condition guard (concurrent IPN flips to confirmed mid-cancel) ─
  it("aborts cleanly when the registration progressed to confirmed mid-tx (IPN race)", async () => {
    // Outer read still sees `pending_payment` (caller isn't blocked
    // by the outer guard), but the in-tx re-read sees the registration
    // has been flipped to `confirmed` by a concurrent IPN — the tx
    // refuses the cancel rather than wiping a now-paid registration.
    const outerReg = buildReg({ status: "pending_payment" });
    const inTxReg = { ...outerReg, status: "confirmed" };
    mockRegRepo.findByIdOrThrow.mockResolvedValue(outerReg);
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      id: outerReg.id,
      data: () => inTxReg,
    });

    await expect(service.cancelPending("reg-1", owner)).rejects.toThrow(
      /n'est plus en attente|already cancelled|déjà annulée/i,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  // ── Permission denial — no registration:cancel_own at all ──────────────
  it("rejects callers without registration:cancel_own permission", async () => {
    const noPermUser = buildAuthUser({ uid: "user-1", roles: [] as never[] });
    const reg = buildReg({ status: "pending_payment" });
    mockRegRepo.findByIdOrThrow.mockResolvedValue(reg);

    await expect(service.cancelPending("reg-1", noPermUser)).rejects.toThrow(
      /Permission manquante/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });
});


