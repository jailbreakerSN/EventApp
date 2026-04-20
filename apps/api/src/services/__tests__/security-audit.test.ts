/**
 * SECURITY AUDIT TEST SUITE — Teranga Event Platform
 *
 * These tests MUST pass before every merge. They verify:
 * 1. Cross-organization data isolation (IDOR prevention)
 * 2. Permission enforcement on service methods
 * 3. Payment state machine integrity
 * 4. Input validation boundaries (XOF, phone, QR)
 * 5. Soft-delete enforcement
 * 6. Role escalation prevention
 *
 * Run: npx vitest run src/services/__tests__/security-audit.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildStaffUser,
  buildSuperAdmin,
  buildEvent,
  buildPayment,
} from "@/__tests__/factories";
import { EventService } from "../event.service";
import { PaymentService } from "../payment.service";
import { type CreateEventDto, type CloneEventDto } from "@teranga/shared-types";
// QR signing imported dynamically in tests to avoid mock conflicts

// ─── Mocks (matching event.service.test.ts pattern) ────────────────────────

const mockEventRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findBySlug: vi.fn(),
  findPublished: vi.fn(),
  findByOrganization: vi.fn(),
  search: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  softDelete: vi.fn(),
};

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockRegistrationRepo = {
  findByIdOrThrow: vi.fn(),
  findById: vi.fn(),
  findByEventAndUser: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findByEvent: vi.fn(),
  countByEvent: vi.fn(),
  countByEventAndStatus: vi.fn(),
};

const mockPaymentRepo = {
  findByIdOrThrow: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findByEvent: vi.fn(),
  findByProviderTxId: vi.fn(),
  getSummary: vi.fn(),
};

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

vi.mock("@/repositories/registration.repository", () => ({
  registrationRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockRegistrationRepo as Record<string, unknown>)[p as string],
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

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "security-test",
}));

const mockTxUpdate = vi.fn();
const mockTxGet = vi.fn();

vi.mock("@/config/firebase", () => ({
  db: {
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { get: mockTxGet, update: mockTxUpdate };
      return fn(tx);
    }),
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ id: "mock-doc" })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
    })),
  },
  COLLECTIONS: {
    EVENTS: "events",
    REGISTRATIONS: "registrations",
    PAYMENTS: "payments",
    BADGES: "badges",
    ORGANIZATIONS: "organizations",
    USERS: "users",
    AUDIT_LOGS: "auditLogs",
  },
}));

// ─── Constants ──────────────────────────────────────────────────────────────

const ORG_A = "org-alpha";
const ORG_B = "org-beta";
const orgAUser = buildOrganizerUser(ORG_A, { uid: "user-a" });
const orgBUser = buildOrganizerUser(ORG_B, { uid: "user-b" });
const participant = buildAuthUser({ uid: "part-1", roles: ["participant"] });
const noRoleUser = buildAuthUser({ uid: "no-role", roles: [] as never });
const staff = buildStaffUser({ uid: "staff-1", organizationId: ORG_A });
const superAdmin = buildSuperAdmin({ uid: "admin-1" });

const eventOrgA = buildEvent({ id: "evt-a", organizationId: ORG_A });
const _eventOrgB = buildEvent({ id: "evt-b", organizationId: ORG_B });
const draftEvent = buildEvent({ id: "evt-draft", organizationId: ORG_A, status: "draft" });

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. CROSS-ORGANIZATION DATA ISOLATION
// ═══════════════════════════════════════════════════════════════════════════

describe("SECURITY: Cross-Org Isolation", () => {
  const service = new EventService();

  it("denies org-B user from updating org-A event", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(service.update("evt-a", { title: "Hijacked" }, orgBUser)).rejects.toThrow();
  });

  it("denies org-B user from publishing org-A event", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(draftEvent);
    await expect(service.publish("evt-draft", orgBUser)).rejects.toThrow();
  });

  it("denies org-B user from archiving org-A event", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(service.archive("evt-a", orgBUser)).rejects.toThrow();
  });

  it("denies org-B user from cloning org-A event", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(service.clone("evt-a", {} as CloneEventDto, orgBUser)).rejects.toThrow();
  });

  it("allows org-A user to update their own event", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    mockEventRepo.update.mockResolvedValue({ ...eventOrgA, title: "Updated" });
    await expect(service.update("evt-a", { title: "Updated" }, orgAUser)).resolves.not.toThrow();
  });

  it("allows super_admin to update any event", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    mockEventRepo.update.mockResolvedValue({ ...eventOrgA, title: "Admin" });
    await expect(service.update("evt-a", { title: "Admin" }, superAdmin)).resolves.not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PERMISSION ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("SECURITY: Permission Enforcement", () => {
  const service = new EventService();

  const createDto = {
    title: "Test",
    description: "Desc",
    category: "conference" as const,
    format: "in_person" as const,
    location: { name: "V", address: "A", city: "Dakar", country: "SN" },
    startDate: new Date().toISOString(),
    endDate: new Date().toISOString(),
    timezone: "Africa/Dakar",
    isPublic: true,
    requiresApproval: false,
  } as CreateEventDto;

  it("denies no-role user from creating events", async () => {
    await expect(service.create(createDto, noRoleUser)).rejects.toThrow("Permission manquante");
  });

  it("denies participant from creating events", async () => {
    await expect(service.create(createDto, participant)).rejects.toThrow("Permission manquante");
  });

  it("denies staff from creating events", async () => {
    await expect(service.create(createDto, staff)).rejects.toThrow("Permission manquante");
  });

  it("denies participant from updating events", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(service.update("evt-a", { title: "X" }, participant)).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("denies participant from publishing events", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(draftEvent);
    await expect(service.publish("evt-draft", participant)).rejects.toThrow("Permission manquante");
  });

  it("denies participant from archiving events", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(service.archive("evt-a", participant)).rejects.toThrow("Permission manquante");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. PAYMENT STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════

describe("SECURITY: Payment State Machine", () => {
  const payService = new PaymentService();

  it("denies refund on failed payment", async () => {
    const payment = buildPayment({
      id: "p-1",
      status: "failed",
      organizationId: ORG_A,
      eventId: "evt-a",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(payService.refundPayment("p-1", undefined, undefined, orgAUser)).rejects.toThrow();
  });

  it("denies refund exceeding original amount", async () => {
    const payment = buildPayment({
      id: "p-2",
      status: "succeeded",
      amount: 5000,
      refundedAmount: 0,
      organizationId: ORG_A,
      eventId: "evt-a",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(payService.refundPayment("p-2", 999999, undefined, orgAUser)).rejects.toThrow();
  });

  it("denies non-integer refund amount (XOF)", async () => {
    const payment = buildPayment({
      id: "p-3",
      status: "succeeded",
      amount: 5000,
      refundedAmount: 0,
      organizationId: ORG_A,
      eventId: "evt-a",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(payService.refundPayment("p-3", 1000.5, undefined, orgAUser)).rejects.toThrow(
      "entier",
    );
  });

  it("denies cross-org refund", async () => {
    const payment = buildPayment({
      id: "p-4",
      status: "succeeded",
      amount: 5000,
      refundedAmount: 0,
      organizationId: ORG_A,
      eventId: "evt-a",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(payService.refundPayment("p-4", undefined, undefined, orgBUser)).rejects.toThrow();
  });

  it("denies participant from refunding", async () => {
    const payment = buildPayment({
      id: "p-5",
      status: "succeeded",
      amount: 5000,
      refundedAmount: 0,
      organizationId: ORG_A,
      eventId: "evt-a",
    });
    mockPaymentRepo.findByIdOrThrow.mockResolvedValue(payment);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(
      payService.refundPayment("p-5", undefined, undefined, participant),
    ).rejects.toThrow("Permission manquante");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. INPUT VALIDATION BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════════

describe("SECURITY: Input Validation", () => {
  describe("XOF integer enforcement", () => {
    it("TicketType price rejects decimals", async () => {
      const { TicketTypeSchema } = await import("@teranga/shared-types");
      const result = TicketTypeSchema.safeParse({
        id: "tt-1",
        name: "VIP",
        price: 5000.5,
        currency: "XOF",
        totalQuantity: 100,
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      });
      expect(result.success).toBe(false);
    });

    it("TicketType price accepts valid integer", async () => {
      const { TicketTypeSchema } = await import("@teranga/shared-types");
      const result = TicketTypeSchema.safeParse({
        id: "tt-2",
        name: "Standard",
        price: 5000,
        currency: "XOF",
        totalQuantity: 100,
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      });
      expect(result.success).toBe(true);
    });

    it("PromoCode fixed discount rejects decimals", async () => {
      const { CreatePromoCodeSchema } = await import("@teranga/shared-types");
      const result = CreatePromoCodeSchema.safeParse({
        code: "DAKAR50",
        discountType: "fixed",
        discountValue: 500.75,
        eventId: "ev-1",
      });
      expect(result.success).toBe(false);
    });

    it("PromoCode percentage allows decimals", async () => {
      const { CreatePromoCodeSchema } = await import("@teranga/shared-types");
      const result = CreatePromoCodeSchema.safeParse({
        code: "DAKAR10",
        discountType: "percentage",
        discountValue: 10.5,
        eventId: "ev-1",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Senegal phone validation", () => {
    it("rejects non-Senegalese phone numbers", async () => {
      const { isValidSenegalPhone } = await import("@teranga/shared-types");
      expect(isValidSenegalPhone("+33612345678")).toBe(false);
      expect(isValidSenegalPhone("+1234567890")).toBe(false);
      expect(isValidSenegalPhone("invalid")).toBe(false);
      expect(isValidSenegalPhone("")).toBe(false);
    });

    it("accepts valid Senegalese formats", async () => {
      const { isValidSenegalPhone } = await import("@teranga/shared-types");
      expect(isValidSenegalPhone("+221771234567")).toBe(true);
      expect(isValidSenegalPhone("+221761234567")).toBe(true);
      expect(isValidSenegalPhone("+221701234567")).toBe(true);
    });
  });

  describe("QR code signing integrity", () => {
    // QR signing tests are covered in qr-signing.test.ts
    // Here we verify the security invariants hold
    const WIDE_NB = Date.now() - 86400_000;
    const WIDE_NA = Date.now() + 365 * 86400_000;

    it("tampered QR codes are rejected (falsy)", async () => {
      const qr = await import("../qr-signing");
      const signed = qr.signQrPayload("reg-1", "event-1", "user-1", WIDE_NB, WIDE_NA);
      const tampered = signed.replace("reg-1", "reg-2");
      expect(qr.verifyQrPayload(tampered)).toBeFalsy();
    });

    it("truncated signatures are rejected", async () => {
      const qr = await import("../qr-signing");
      const signed = qr.signQrPayload("reg-1", "event-1", "user-1", WIDE_NB, WIDE_NA);
      const truncated = signed.slice(0, -10);
      expect(qr.verifyQrPayload(truncated)).toBeFalsy();
    });

    it("valid QR codes are accepted", async () => {
      const qr = await import("../qr-signing");
      const signed = qr.signQrPayload("reg-1", "event-1", "user-1", WIDE_NB, WIDE_NA);
      expect(qr.verifyQrPayload(signed)).toBeTruthy();
    });

    it("empty/malformed QR codes are rejected", async () => {
      const qr = await import("../qr-signing");
      expect(qr.verifyQrPayload("")).toBeFalsy();
      expect(qr.verifyQrPayload("no-colons")).toBeFalsy();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. SOFT-DELETE ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("SECURITY: Soft-Delete Enforcement", () => {
  const service = new EventService();

  it("archive sets status, does not hard delete", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    mockEventRepo.softDelete.mockResolvedValue({ ...eventOrgA, status: "archived" });

    await service.archive("evt-a", superAdmin);

    // Verify it calls softDelete (status = archived), NOT a Firestore delete()
    expect(mockEventRepo.softDelete).toHaveBeenCalledWith("evt-a", "status", "archived");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ROLE ESCALATION PREVENTION
// ═══════════════════════════════════════════════════════════════════════════

describe("SECURITY: Role Escalation Prevention", () => {
  const service = new EventService();

  it("staff cannot create events", async () => {
    await expect(
      service.create(
        {
          title: "X",
          description: "X",
          category: "conference" as const,
          format: "in_person" as const,
          location: { name: "X", address: "X", city: "Dakar", country: "SN" },
          startDate: new Date().toISOString(),
          endDate: new Date().toISOString(),
          timezone: "Africa/Dakar",
          isPublic: true,
          requiresApproval: false,
        } as CreateEventDto,
        staff,
      ),
    ).rejects.toThrow("Permission manquante");
  });

  it("staff cannot publish events", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(draftEvent);
    await expect(service.publish("evt-draft", staff)).rejects.toThrow("Permission manquante");
  });

  it("participant cannot archive events", async () => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(eventOrgA);
    await expect(service.archive("evt-a", participant)).rejects.toThrow("Permission manquante");
  });
});
