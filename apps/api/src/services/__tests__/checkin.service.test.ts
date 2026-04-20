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

const { mockEventEmit } = vi.hoisted(() => ({ mockEventEmit: vi.fn() }));
vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: mockEventEmit },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

vi.mock("@/services/qr-signing", () => ({
  verifyQrPayload: vi.fn((qr: string) => {
    if (qr.startsWith("invalid")) return null;
    return { registrationId: "reg-1", eventId: "ev-1", userId: "user-1", version: "v3" };
  }),
  // Wide-open window so the bulk-sync staleness check never fires in this
  // suite — coverage for the window itself lives in qr-signing.test.ts
  // and the integration suite.
  checkScanTime: vi.fn(() => "valid"),
  computeValidityWindow: vi.fn(() => ({
    notBefore: Date.now() - 86_400_000,
    notAfter: Date.now() + 365 * 86_400_000,
  })),
  SCAN_CLOCK_SKEW_MS: 2 * 60 * 60 * 1000,
}));

const mockTxUpdate = vi.fn();
const mockTxGetReg = vi.fn();
const mockTxGetEvent = vi.fn();
// Tagged refs so the in-tx dispatch can tell registration reads apart from
// event reads — processCheckinItem does `Promise.all([tx.get(regRef),
// tx.get(eventRef)])` and we need the right snap back for each.
const regRef = { id: "mock-reg", __collection: "registrations" };
const eventRef = { id: "mock-event", __collection: "events" };

vi.mock("@/config/firebase", () => ({
  db: {
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: (ref: { __collection?: string }) =>
          ref.__collection === "events" ? mockTxGetEvent() : mockTxGetReg(),
        update: mockTxUpdate,
      };
      return fn(tx);
    }),
    collection: vi.fn((name: string) => ({
      // Stub doc with a .set() so the shadow-write path in
      // processCheckinItem (fire-and-forget checkins write after tx
      // commits) doesn't log `ref.set is not a function` in tests.
      // Assertions on shadow-write shape live in the integration suite.
      doc: vi.fn(() => ({
        ...(name === "events" ? eventRef : regRef),
        set: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
  COLLECTIONS: {
    REGISTRATIONS: "registrations",
    EVENTS: "events",
    CHECKINS: "checkins",
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new CheckinService();

beforeEach(() => {
  vi.clearAllMocks();
  // bulkSync is gated behind the `qrScanning` plan feature — every test
  // needs a starter-or-better org returned by the repository lookup.
  mockOrgRepo.findByIdOrThrow.mockResolvedValue(
    buildOrganization({ id: "org-1", plan: "starter" }),
  );
  // Default event snap carries startDate + endDate so the window-check
  // fallback path doesn't fail closed. Tests that need a custom event
  // payload (e.g. zone capacity) can override.
  mockTxGetEvent.mockResolvedValue({
    exists: true,
    data: () => ({
      startDate: new Date(Date.now() - 86_400_000).toISOString(),
      endDate: new Date(Date.now() + 86_400_000).toISOString(),
      accessZones: [],
      zoneCheckedInCounts: {},
    }),
  });
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
    mockTxGetReg.mockResolvedValue({
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

  it("persists scanner attestation (device id on registration, nonce + client time on audit event)", async () => {
    const user = buildStaffUser({ organizationId: "org-1" });
    const reg = buildRegistration({ eventId: event.id, status: "confirmed" });
    const scannedAt = new Date(Date.now() - 60_000).toISOString();

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockRegRepo.findByQrCode.mockResolvedValue(reg);
    mockTxGetReg.mockResolvedValue({
      exists: true,
      id: reg.id,
      data: () => ({ ...reg, id: undefined }),
    });
    mockUserRepo.findById.mockResolvedValue({ displayName: "Test User" });

    await service.bulkSync(
      event.id,
      [
        {
          localId: "local-1",
          qrCodeValue: reg.qrCodeValue,
          scannedAt,
          scannerDeviceId: "device-ios-abc123",
          scannerNonce: "deadbeefcafebabe",
        },
      ],
      user,
    );

    // Registration doc: device id persisted for O(1) "who scanned this" lookups.
    const regUpdate = mockTxUpdate.mock.calls.find(
      (call) => (call[1] as Record<string, unknown>).status === "checked_in",
    );
    expect(regUpdate).toBeDefined();
    expect((regUpdate![1] as Record<string, unknown>).checkedInDeviceId).toBe("device-ios-abc123");

    // Audit event: nonce + client-reported time + live/offline source.
    const completedCall = mockEventEmit.mock.calls.find((c) => c[0] === "checkin.completed");
    expect(completedCall).toBeDefined();
    const payload = completedCall![1] as Record<string, unknown>;
    expect(payload.scannerDeviceId).toBe("device-ios-abc123");
    expect(payload.scannerNonce).toBe("deadbeefcafebabe");
    expect(payload.clientScannedAt).toBe(scannedAt);
    expect(payload.source).toBe("offline_sync");
  });

  it("accepts items without attestation and writes null (backward compat with older app builds)", async () => {
    const user = buildStaffUser({ organizationId: "org-1" });
    const reg = buildRegistration({ eventId: event.id, status: "confirmed" });

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockRegRepo.findByQrCode.mockResolvedValue(reg);
    mockTxGetReg.mockResolvedValue({
      exists: true,
      id: reg.id,
      data: () => ({ ...reg, id: undefined }),
    });
    mockUserRepo.findById.mockResolvedValue({ displayName: "Test User" });

    await service.bulkSync(
      event.id,
      [{ localId: "local-1", qrCodeValue: reg.qrCodeValue, scannedAt: new Date().toISOString() }],
      user,
    );

    const regUpdate = mockTxUpdate.mock.calls.find(
      (call) => (call[1] as Record<string, unknown>).status === "checked_in",
    );
    expect((regUpdate![1] as Record<string, unknown>).checkedInDeviceId).toBeNull();

    const completedCall = mockEventEmit.mock.calls.find((c) => c[0] === "checkin.completed");
    const payload = completedCall![1] as Record<string, unknown>;
    expect(payload.scannerDeviceId).toBeNull();
    expect(payload.scannerNonce).toBeNull();
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
    mockTxGetReg.mockResolvedValue({
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
    mockTxGetReg.mockResolvedValue({
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

// ─── listCheckins / getAnomalies (Sprint C 3.3 c3/5 + 4.3) ─────────────────
// The full chain (where × N → orderBy → offset → limit → get) is painful to
// exercise against a hand-rolled mock; happy-path correctness is covered
// end-to-end in the integration suite. These unit cases lock in the
// guards: permission, org-access, plan-feature gate.

describe("CheckinService.listCheckins", () => {
  it("rejects a participant without checkin:view_log", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    await expect(service.listCheckins("ev-1", { page: 1, limit: 20 }, user)).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("rejects staff from a different org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.listCheckins(event.id, { page: 1, limit: 20 }, user)).rejects.toThrow(
      "Accès refusé",
    );
  });
});

describe("CheckinService.getAnomalies", () => {
  it("rejects a participant without checkin:view_log", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.getAnomalies("ev-1", { windowMinutes: 10, velocityThreshold: 60 }, user),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects staff from a different org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.getAnomalies(event.id, { windowMinutes: 10, velocityThreshold: 60 }, user),
    ).rejects.toThrow("Accès refusé");
  });

  it("rejects orgs without the advancedAnalytics plan feature (free / starter)", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    // Free + starter tiers don't have advancedAnalytics. beforeEach mocked
    // starter; override to be explicit.
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({ id: "org-1", plan: "starter" }),
    );

    await expect(
      service.getAnomalies(event.id, { windowMinutes: 10, velocityThreshold: 60 }, user),
    ).rejects.toThrow(/plan|feature|advanced/i);
  });
});
