import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, PlanLimitError } from "@/errors/app-error";
import { buildAuthUser, buildOrganizerUser } from "@/__tests__/factories";
import type { Event, Payment, Registration } from "@teranga/shared-types";

// ─── Hoisted mocks for the integration tests below ────────────────────────
//
// The pure-helper tests at the top of this file don't use these mocks
// (they import only `buildCohortRows` + `formatCsv`). The bottom
// integration tests exercise `cohortExportService.exportCsv` and need
// Firestore + repos mocked.

const hoisted = vi.hoisted(() => ({
  emitMock: vi.fn(),
  orgPlan: "pro" as "free" | "starter" | "pro" | "enterprise",
  registrations: [] as Registration[],
  payments: [] as Payment[],
}));

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: async () => ({
        docs: hoisted.registrations.map((r) => ({ data: () => r })),
      }),
    })),
  },
  COLLECTIONS: { REGISTRATIONS: "registrations" },
}));

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: {
    findByIdOrThrow: vi.fn(async (id: string) => ({
      id,
      organizationId: "org-1",
      ticketTypes: [
        {
          id: "tt-std",
          name: "Standard",
          price: 10000,
          totalQuantity: 1000,
          currency: "XOF",
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      startDate: "2026-04-26T10:00:00.000Z",
      endDate: "2026-04-26T18:00:00.000Z",
    })),
  },
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: {
    findByIdOrThrow: vi.fn(async (id: string) => ({ id, plan: hoisted.orgPlan })),
  },
}));

vi.mock("@/repositories/payment.repository", () => ({
  paymentRepository: {
    findByEvent: vi.fn(async () => ({
      data: hoisted.payments,
      meta: { total: hoisted.payments.length, page: 1, limit: 10000, totalPages: 1 },
    })),
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: hoisted.emitMock },
}));

vi.mock("@/context/request-context", () => ({
  getRequestContext: () => ({ requestId: "test-request-id" }),
  getRequestId: () => "test-request-id",
  trackFirestoreReads: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.orgPlan = "pro";
  hoisted.registrations = [];
  hoisted.payments = [];
});

import { buildCohortRows, formatCsv, cohortExportService } from "../cohort-export.service";

// ─── Cohort export — segmenting + CSV format ─────────────────────────────
//
// Two pure helpers carry the load:
//   - `buildCohortRows()` filters by segment + merges payments
//   - `formatCsv()` renders RFC-4180 + UTF-8 BOM
// We assert behavior at the boundary so a refactor that shuffles the
// segment semantics or breaks the BOM/CRLF surfaces here.

const baseRegistration: Registration = {
  id: "reg-1",
  eventId: "evt-1",
  userId: "u-1",
  ticketTypeId: "tt-std",
  participantName: "Awa Diop",
  participantEmail: "awa@example.com",
  status: "confirmed",
  qrCodeValue: "qr-1",
  checkedInAt: null,
  checkedInBy: null,
  accessZoneId: null,
  notes: null,
  createdAt: "2026-04-01T10:00:00.000Z",
  updatedAt: "2026-04-01T10:00:00.000Z",
};

const event: Pick<Event, "ticketTypes"> = {
  ticketTypes: [
    {
      id: "tt-std",
      name: "Standard",
      price: 10000,
      totalQuantity: 1000,
      currency: "XOF",
      soldCount: 0,
      accessZoneIds: [],
      isVisible: true,
    },
  ] as Event["ticketTypes"],
};

function makePayment(over: Partial<Payment>): Payment {
  return {
    id: "pay-1",
    registrationId: "reg-1",
    eventId: "evt-1",
    organizationId: "org-1",
    userId: "u-1",
    amount: 10_000,
    currency: "XOF",
    method: "wave",
    providerTransactionId: null,
    status: "succeeded",
    redirectUrl: null,
    callbackUrl: null,
    returnUrl: null,
    providerMetadata: null,
    failureReason: null,
    refundedAmount: 0,
    initiatedAt: "2026-04-01T10:00:00.000Z",
    completedAt: "2026-04-01T10:01:00.000Z",
    createdAt: "2026-04-01T10:00:00.000Z",
    updatedAt: "2026-04-01T10:01:00.000Z",
    ...over,
  };
}

describe("buildCohortRows — segment filtering", () => {
  const checkedIn: Registration = {
    ...baseRegistration,
    id: "reg-attended",
    status: "checked_in",
    checkedInAt: "2026-04-26T11:00:00.000Z",
  };
  const noShow: Registration = {
    ...baseRegistration,
    id: "reg-no-show",
    participantName: "Bineta Sy",
    status: "confirmed",
    checkedInAt: null,
  };
  const cancelled: Registration = {
    ...baseRegistration,
    id: "reg-cancelled",
    participantName: "Cheikh Diop",
    status: "cancelled",
  };

  it("'attended' returns only registrations with checkedInAt", () => {
    const out = buildCohortRows([checkedIn, noShow, cancelled], [], event, "attended", true);
    expect(out).toHaveLength(1);
    expect(out[0].registrationId).toBe("reg-attended");
  });

  it("'no_show' returns confirmed-without-checkin only after the event ends", () => {
    const before = buildCohortRows([checkedIn, noShow, cancelled], [], event, "no_show", false);
    expect(before).toHaveLength(0);
    const after = buildCohortRows([checkedIn, noShow, cancelled], [], event, "no_show", true);
    expect(after.map((r) => r.registrationId)).toEqual(["reg-no-show"]);
  });

  it("'cancelled' returns only the cancelled rows", () => {
    const out = buildCohortRows([checkedIn, noShow, cancelled], [], event, "cancelled", true);
    expect(out.map((r) => r.registrationId)).toEqual(["reg-cancelled"]);
  });

  it("'all' returns every row regardless of state", () => {
    const out = buildCohortRows([checkedIn, noShow, cancelled], [], event, "all", true);
    expect(out).toHaveLength(3);
  });

  it("merges payments by registrationId, summing amount + refundedAmount", () => {
    const reg: Registration = {
      ...baseRegistration,
      id: "reg-1",
      status: "checked_in",
      checkedInAt: "2026-04-26T10:00:00.000Z",
    };
    const payments: Payment[] = [
      makePayment({ id: "p1", registrationId: "reg-1", amount: 10_000 }),
      makePayment({
        id: "p2",
        registrationId: "reg-1",
        amount: 10_000,
        refundedAmount: 4_000,
      }),
    ];
    const out = buildCohortRows([reg], payments, event, "attended", true);
    expect(out[0].amountPaid).toBe(20_000);
    expect(out[0].refundedAmount).toBe(4_000);
  });

  it("ignores failed payments — only succeeded contribute to amountPaid", () => {
    const reg: Registration = {
      ...baseRegistration,
      id: "reg-1",
      status: "checked_in",
      checkedInAt: "2026-04-26T10:00:00.000Z",
    };
    const payments: Payment[] = [
      makePayment({ id: "p1", registrationId: "reg-1", amount: 10_000 }),
      makePayment({
        id: "p2",
        registrationId: "reg-1",
        amount: 10_000,
        status: "failed",
      }),
    ];
    const out = buildCohortRows([reg], payments, event, "attended", true);
    expect(out[0].amountPaid).toBe(10_000);
  });

  it("ignores 'processing' + 'expired' payments — only 'succeeded' counts (Phase-2 states)", () => {
    // Develop's payments overhaul added 'processing' and 'expired' to
    // PaymentStatus. Neither contributes to amountPaid — only fully
    // confirmed payments do.
    const reg: Registration = {
      ...baseRegistration,
      id: "reg-1",
      status: "checked_in",
      checkedInAt: "2026-04-26T10:00:00.000Z",
    };
    const payments: Payment[] = [
      makePayment({ id: "p1", registrationId: "reg-1", amount: 10_000 }),
      makePayment({
        id: "p2",
        registrationId: "reg-1",
        amount: 5_000,
        status: "processing",
      }),
      makePayment({
        id: "p3",
        registrationId: "reg-1",
        amount: 7_000,
        status: "expired",
      }),
    ];
    const out = buildCohortRows([reg], payments, event, "attended", true);
    expect(out[0].amountPaid).toBe(10_000);
    expect(out[0].refundedAmount).toBe(0);
  });

  it("sorts the output by participantName fr-locale ASC", () => {
    const out = buildCohortRows(
      [
        { ...baseRegistration, id: "r3", participantName: "Cheikh" },
        { ...baseRegistration, id: "r1", participantName: "Awa" },
        { ...baseRegistration, id: "r2", participantName: "Bineta" },
      ],
      [],
      event,
      "all",
      true,
    );
    expect(out.map((r) => r.participantName)).toEqual(["Awa", "Bineta", "Cheikh"]);
  });

  it("attaches the ticket type label from the event's ticketTypes", () => {
    const out = buildCohortRows([baseRegistration], [], event, "all", true);
    expect(out[0].ticketTypeName).toBe("Standard");
  });

  it("sets npsBucket to null (forward-compat placeholder)", () => {
    const out = buildCohortRows([baseRegistration], [], event, "all", true);
    expect(out[0].npsBucket).toBeNull();
  });
});

describe("formatCsv — RFC-4180 + UTF-8 BOM", () => {
  it("starts with a UTF-8 BOM and ends with a CRLF", () => {
    const csv = formatCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("emits a header row even for an empty dataset", () => {
    const csv = formatCsv([]);
    expect(csv).toContain("registrationId,userId,participantName");
  });

  it("quotes string fields and doubles embedded quotes", () => {
    const csv = formatCsv([
      {
        registrationId: "reg-1",
        userId: "u-1",
        participantName: 'Aïsha "La Comète"',
        participantEmail: "ai@example.com",
        ticketTypeName: "VIP",
        status: "checked_in",
        checkedInAt: "2026-04-26T10:00:00.000Z",
        amountPaid: 50000,
        refundedAmount: 0,
        npsBucket: null,
      },
    ]);
    expect(csv).toContain('"Aïsha ""La Comète"""');
  });

  it("emits empty cells for null fields", () => {
    const csv = formatCsv([
      {
        registrationId: "reg-1",
        userId: "u-1",
        participantName: null,
        participantEmail: null,
        ticketTypeName: null,
        status: "cancelled",
        checkedInAt: null,
        amountPaid: 0,
        refundedAmount: 0,
        npsBucket: null,
      },
    ]);
    // The "participantName" cell sits between "u-1" and the next quoted
    // field — verify it's empty rather than the literal "null".
    expect(csv).toContain('"reg-1","u-1",,,,"cancelled",,0,0,');
  });
});

// ─── exportCsv() — service integration (permission + plan gate + emit) ────

describe("cohortExportService.exportCsv — service integration", () => {
  it("returns the CSV + emits cohort_export.downloaded (happy path)", async () => {
    hoisted.registrations = [
      {
        id: "reg-1",
        eventId: "evt-1",
        userId: "u-1",
        ticketTypeId: "tt-std",
        participantName: "Awa Diop",
        participantEmail: "awa@example.com",
        status: "checked_in",
        qrCodeValue: "qr-1",
        checkedInAt: "2026-04-26T11:00:00.000Z",
        checkedInBy: null,
        accessZoneId: null,
        notes: null,
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-26T11:00:00.000Z",
      } as Registration,
    ];
    const user = buildOrganizerUser("org-1");
    const result = await cohortExportService.exportCsv("evt-1", "all", user);
    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain("Awa Diop");
    expect(hoisted.emitMock).toHaveBeenCalledWith(
      "cohort_export.downloaded",
      expect.objectContaining({ segment: "all", rowCount: 1 }),
    );
  });

  it("rejects callers without registration:export (permission denial)", async () => {
    const participant = buildAuthUser({ roles: ["participant"], organizationId: "org-1" });
    await expect(
      cohortExportService.exportCsv("evt-1", "all", participant),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects callers from another organisation (cross-org)", async () => {
    const otherOrg = buildOrganizerUser("org-2");
    await expect(
      cohortExportService.exportCsv("evt-1", "all", otherOrg),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws PlanLimitError when the org's plan does not include `csvExport`", async () => {
    hoisted.orgPlan = "free";
    const user = buildOrganizerUser("org-1");
    await expect(
      cohortExportService.exportCsv("evt-1", "all", user),
    ).rejects.toBeInstanceOf(PlanLimitError);
    // Defensive: no audit emit when the gate fires before the read.
    expect(hoisted.emitMock).not.toHaveBeenCalled();
  });
});
