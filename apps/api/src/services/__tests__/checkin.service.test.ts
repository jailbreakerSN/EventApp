import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckinService } from "../checkin.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildStaffUser,
  buildEvent,
  buildOrganization,
  buildRegistration,
} from "@/__tests__/factories";
import { type UserRole } from "@teranga/shared-types";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockRegRepo = {
  findByEventCursor: vi.fn(),
  findByEvent: vi.fn(),
  findByQrCode: vi.fn(),
};

const mockUserRepo = {
  batchGet: vi.fn(),
  findById: vi.fn(),
};

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
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

vi.mock("@/repositories/user.repository", () => ({
  userRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockUserRepo as Record<string, unknown>)[prop as string],
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

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

vi.mock("@/services/qr-signing", () => ({
  verifyQrPayload: vi.fn((qr: string) => {
    if (qr.startsWith("invalid")) return null;
    return { registrationId: "reg-1", eventId: "ev-1", userId: "user-1" };
  }),
}));

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
  COLLECTIONS: { REGISTRATIONS: "registrations", EVENTS: "events" },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new CheckinService();

beforeEach(() => {
  vi.clearAllMocks();
  // bulkSync is gated behind the `qrScanning` plan feature — every test
  // needs a starter-or-better org returned by the repository lookup.
  mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrganization({ id: "org-1", plan: "starter" }));
});

describe("CheckinService.getOfflineSyncData", () => {
  it("returns sync payload with registrations and participant info", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      accessZones: [
        { id: "zone-1", name: "VIP", color: "#FF0000", allowedTicketTypes: ["tt-1"], capacity: 50 },
      ],
    });
    const reg = buildRegistration({
      eventId: event.id,
      userId: "user-1",
      ticketTypeId: "ticket-standard",
    });

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockRegRepo.findByEventCursor.mockResolvedValue({ data: [reg], lastDoc: null });
    mockUserRepo.batchGet.mockResolvedValue([
      { uid: "user-1", id: "user-1", displayName: "Amadou Diallo", email: "amadou@test.com" },
    ]);

    const result = await service.getOfflineSyncData(event.id, user);

    expect(result.eventId).toBe(event.id);
    expect(result.registrations).toHaveLength(1);
    expect(result.registrations[0].participantName).toBe("Amadou Diallo");
    expect(result.accessZones).toHaveLength(1);
    expect(result.ticketTypes).toHaveLength(1);
  });

  it("rejects if user lacks permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.getOfflineSyncData("ev-1", user)).rejects.toThrow("Permission manquante");
  });

  it("rejects if user is not in the event's org", async () => {
    const user = buildOrganizerUser("org-other");
    user.roles = [...user.roles, "staff"] as UserRole[];
    const event = buildEvent({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.getOfflineSyncData(event.id, user)).rejects.toThrow("Accès refusé");
  });
});

describe("CheckinService.bulkSync", () => {
  const event = buildEvent({ organizationId: "org-1" });

  it("processes valid check-ins successfully", async () => {
    const user = buildStaffUser({ organizationId: "org-1" });
    const reg = buildRegistration({ eventId: event.id, status: "confirmed" });

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockRegRepo.findByQrCode.mockResolvedValue(reg);
    mockTxGet.mockResolvedValue({
      exists: true,
      id: reg.id,
      data: () => ({ ...reg, id: undefined }),
    });
    mockUserRepo.findById.mockResolvedValue({ displayName: "Test User" });

    const result = await service.bulkSync(
      event.id,
      [{ localId: "local-1", qrCodeValue: reg.qrCodeValue, scannedAt: new Date().toISOString() }],
      user,
    );

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].status).toBe("success");
  });

  it("returns invalid_qr for bad QR codes", async () => {
    const user = buildStaffUser({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    const result = await service.bulkSync(
      event.id,
      [{ localId: "local-1", qrCodeValue: "invalid-qr-code", scannedAt: new Date().toISOString() }],
      user,
    );

    expect(result.results[0].status).toBe("invalid_qr");
    expect(result.failed).toBe(1);
  });

  it("returns cancelled status when registration is cancelled", async () => {
    const user = buildStaffUser({ organizationId: "org-1" });
    const reg = buildRegistration({ eventId: event.id, status: "cancelled" });

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockRegRepo.findByQrCode.mockResolvedValue(reg);
    mockTxGet.mockResolvedValue({
      exists: true,
      id: reg.id,
      data: () => ({ ...reg, id: undefined }),
    });

    const result = await service.bulkSync(
      event.id,
      [{ localId: "local-1", qrCodeValue: reg.qrCodeValue, scannedAt: new Date().toISOString() }],
      user,
    );

    expect(result.results[0].status).toBe("cancelled");
  });

  it("returns already_checked_in for duplicate scans", async () => {
    const user = buildStaffUser({ organizationId: "org-1" });
    const checkedInAt = new Date().toISOString();
    const reg = buildRegistration({ eventId: event.id, status: "checked_in", checkedInAt });

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockRegRepo.findByQrCode.mockResolvedValue(reg);
    mockTxGet.mockResolvedValue({
      exists: true,
      id: reg.id,
      data: () => ({ ...reg, id: undefined }),
    });

    const result = await service.bulkSync(
      event.id,
      [{ localId: "local-1", qrCodeValue: reg.qrCodeValue, scannedAt: new Date().toISOString() }],
      user,
    );

    expect(result.results[0].status).toBe("already_checked_in");
  });

  it("rejects if user lacks checkin:scan permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(
      service.bulkSync(
        "ev-1",
        [{ localId: "l1", qrCodeValue: "qr", scannedAt: new Date().toISOString() }],
        user,
      ),
    ).rejects.toThrow("Permission manquante");
  });
});

describe("CheckinService.getStats", () => {
  it("returns aggregated statistics", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      accessZones: [
        { id: "zone-1", name: "VIP", color: "#FF0000", allowedTicketTypes: [], capacity: 50 },
      ],
    });

    const regs = [
      buildRegistration({
        eventId: event.id,
        status: "confirmed",
        ticketTypeId: "ticket-standard",
      }),
      buildRegistration({
        eventId: event.id,
        status: "checked_in",
        ticketTypeId: "ticket-standard",
        checkedInAt: new Date().toISOString(),
        accessZoneId: "zone-1",
      }),
    ];

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockRegRepo.findByEvent
      .mockResolvedValueOnce({
        data: regs,
        meta: { page: 1, limit: 10000, total: 2, totalPages: 1 },
      })
      .mockResolvedValueOnce({ data: [], meta: { page: 1, limit: 1, total: 0, totalPages: 0 } });

    const stats = await service.getStats(event.id, user);

    expect(stats.totalRegistered).toBe(2);
    expect(stats.totalCheckedIn).toBe(1);
    expect(stats.byZone[0].checkedIn).toBe(1);
    expect(stats.byTicketType[0].registered).toBe(2);
    expect(stats.byTicketType[0].checkedIn).toBe(1);
  });

  it("rejects if user lacks checkin:view_log permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.getStats("ev-1", user)).rejects.toThrow("Permission manquante");
  });

  it("rejects if user is not in the event's org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.getStats(event.id, user)).rejects.toThrow("Accès refusé");
  });
});
