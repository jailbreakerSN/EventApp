import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildOrganizerUser, buildAuthUser } from "@/__tests__/factories";
import type { Registration } from "@teranga/shared-types";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockRegRepo = {
  findByIdOrThrow: vi.fn(),
  findOldestWaitlisted: vi.fn(),
  findOldestWaitlistedBatch: vi.fn(),
  countWaitlistedOlderThan: vi.fn(),
  countWaitlistedTotal: vi.fn(),
  // Return a doc reference whose id matches the requested id so the
  // transactional `tx.get(regRef)` mocks below can route by id.
  ref: { doc: vi.fn((id: string) => ({ id })) },
};
const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();

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
vi.mock("@/repositories/transaction.helper", () => ({
  runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ get: mockTxGet, update: mockTxUpdate });
  }),
}));
vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));
vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Repositories the service imports but the waitlist tests don't exercise.
vi.mock("@/repositories/badge.repository", () => ({
  badgeRepository: { ref: { doc: vi.fn() } },
}));
vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: { findByIdOrThrow: vi.fn() },
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
  notificationsService: {
    enqueue: vi.fn(),
    send: vi.fn(),
  },
}));

// Import AFTER mocks
import { RegistrationService } from "../registration.service";
import { eventBus } from "@/events/event-bus";

const service = new RegistrationService();

function buildReg(overrides: Partial<Registration> = {}): Registration {
  const now = new Date().toISOString();
  return {
    id: "reg-1",
    eventId: "event-1",
    userId: "user-1",
    ticketTypeId: "ticket-vip",
    status: "waitlisted",
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegistrationService.promoteNextWaitlisted — ticket-type aware", () => {
  it("scopes the FIFO read to the passed ticketTypeId", async () => {
    const candidate = buildReg();
    mockRegRepo.findOldestWaitlisted.mockResolvedValue(candidate);
    mockTxGet.mockResolvedValue({
      exists: true,
      id: candidate.id,
      data: () => candidate,
    });

    await service.promoteNextWaitlisted("event-1", "org-1", "actor-1", "ticket-vip");

    expect(mockRegRepo.findOldestWaitlisted).toHaveBeenCalledWith("event-1", "ticket-vip");
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "confirmed",
        promotedFromWaitlistAt: expect.any(String),
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "waitlist.promoted",
      expect.objectContaining({
        registrationId: "reg-1",
        eventId: "event-1",
        userId: "user-1",
        organizationId: "org-1",
      }),
    );
  });

  it("falls back to global FIFO when ticketTypeId is omitted", async () => {
    const candidate = buildReg({ ticketTypeId: "ticket-standard" });
    mockRegRepo.findOldestWaitlisted.mockResolvedValue(candidate);
    mockTxGet.mockResolvedValue({
      exists: true,
      id: candidate.id,
      data: () => candidate,
    });

    await service.promoteNextWaitlisted("event-1", "org-1", "actor-1");

    expect(mockRegRepo.findOldestWaitlisted).toHaveBeenCalledWith("event-1", undefined);
  });

  it("returns silently when no waitlisted entry exists in scope", async () => {
    mockRegRepo.findOldestWaitlisted.mockResolvedValue(null);

    await service.promoteNextWaitlisted("event-1", "org-1", "actor-1", "ticket-vip");

    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("skips promotion AND skips emit when the doc was raced out of waitlisted state", async () => {
    // B2 senior review remediation — the tx callback now returns a
    // boolean and the `waitlist.promoted` emit is gated on it. A
    // race-loss must NOT fire a false-positive audit event because
    // the audit listener would log a promotion that never happened
    // (and the notification dispatcher would email the user that
    // their waitlist entry is confirmed when it isn't).
    const candidate = buildReg();
    mockRegRepo.findOldestWaitlisted.mockResolvedValue(candidate);
    // tx.get returns a doc with status changed to confirmed before we updated it
    mockTxGet.mockResolvedValue({
      exists: true,
      id: candidate.id,
      data: () => ({ ...candidate, status: "confirmed" }),
    });

    await service.promoteNextWaitlisted("event-1", "org-1", "actor-1", "ticket-vip");

    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});

describe("RegistrationService.bulkPromoteWaitlisted", () => {
  const orgId = "org-1";
  const eventId = "event-1";
  const user = buildOrganizerUser(orgId);

  it("rejects non-organizer callers", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.bulkPromoteWaitlisted(eventId, orgId, participant, 5),
    ).rejects.toThrow(/Permission manquante/);
  });

  it("rejects non-integer or out-of-range count (cap = 25)", async () => {
    // Cap was reduced from 100 → 25 (B2 senior review remediation) to
    // avoid a 100-message email burst on the notification dispatcher.
    await expect(service.bulkPromoteWaitlisted(eventId, orgId, user, 0)).rejects.toThrow(
      /entier entre 1 et 25/,
    );
    await expect(service.bulkPromoteWaitlisted(eventId, orgId, user, 26)).rejects.toThrow(
      /entier entre 1 et 25/,
    );
  });

  it("promotes up to N waitlisted, emitting one event per success", async () => {
    const candidates = [
      buildReg({ id: "reg-1", userId: "u1" }),
      buildReg({ id: "reg-2", userId: "u2" }),
      buildReg({ id: "reg-3", userId: "u3" }),
    ];
    mockRegRepo.findOldestWaitlistedBatch.mockResolvedValue(candidates);
    mockTxGet.mockImplementation(async (ref: { id: string }) => ({
      exists: true,
      id: ref.id,
      data: () => candidates.find((c) => c.id === ref.id) ?? null,
    }));

    const result = await service.bulkPromoteWaitlisted(eventId, orgId, user, 5);

    expect(result.promotedCount).toBe(3);
    expect(result.skipped).toBe(0);
    expect(mockTxUpdate).toHaveBeenCalledTimes(3);
    expect(eventBus.emit).toHaveBeenCalledTimes(3);
  });

  it("counts a candidate already promoted as skipped, not failed", async () => {
    const candidates = [
      buildReg({ id: "reg-1" }),
      buildReg({ id: "reg-2" }),
    ];
    mockRegRepo.findOldestWaitlistedBatch.mockResolvedValue(candidates);
    mockTxGet.mockImplementation(async (ref: { id: string }) => ({
      exists: true,
      id: ref.id,
      // reg-2 was raced to confirmed by another path
      data: () => ({
        ...candidates.find((c) => c.id === ref.id),
        status: ref.id === "reg-2" ? "confirmed" : "waitlisted",
      }),
    }));

    const result = await service.bulkPromoteWaitlisted(eventId, orgId, user, 5);

    expect(result.promotedCount).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("emits waitlist.promotion_failed when a per-entry tx throws", async () => {
    // B2 senior review remediation — silence-as-signal was insufficient
    // for ops; failed bulk entries now carry an explicit audit row.
    const candidates = [buildReg({ id: "reg-1", ticketTypeId: "ticket-vip" })];
    mockRegRepo.findOldestWaitlistedBatch.mockResolvedValue(candidates);
    mockTxGet.mockRejectedValueOnce(new Error("firestore boom"));

    const result = await service.bulkPromoteWaitlisted(eventId, orgId, user, 5);

    expect(result.promotedCount).toBe(0);
    expect(result.skipped).toBe(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      "waitlist.promotion_failed",
      expect.objectContaining({
        eventId,
        organizationId: orgId,
        cancelledRegistrationId: "reg-1",
        ticketTypeId: "ticket-vip",
        reason: "firestore boom",
      }),
    );
  });
});

describe("RegistrationService.getWaitlistPosition", () => {
  it("returns null when the registration isn't waitlisted", async () => {
    mockRegRepo.findByIdOrThrow.mockResolvedValue(
      buildReg({ status: "confirmed" }),
    );
    const user = buildAuthUser({ uid: "user-1" });
    const result = await service.getWaitlistPosition("reg-1", user);
    expect(result).toBeNull();
  });

  it("returns position + total for the owner", async () => {
    mockRegRepo.findByIdOrThrow.mockResolvedValue(buildReg());
    mockRegRepo.countWaitlistedOlderThan.mockResolvedValue(4);
    mockRegRepo.countWaitlistedTotal.mockResolvedValue(12);

    const user = buildAuthUser({ uid: "user-1" });
    const result = await service.getWaitlistPosition("reg-1", user);

    expect(result).toEqual({ position: 5, total: 12 });
    expect(mockRegRepo.countWaitlistedOlderThan).toHaveBeenCalledWith(
      "event-1",
      "ticket-vip",
      expect.any(String),
    );
  });

  it("rejects a non-owner non-organizer", async () => {
    mockRegRepo.findByIdOrThrow.mockResolvedValue(buildReg({ userId: "other-user" }));
    mockEventRepo.findByIdOrThrow.mockResolvedValue({
      id: "event-1",
      organizationId: "different-org",
    });
    const user = buildAuthUser({ uid: "user-1", organizationId: "user-org" });

    await expect(service.getWaitlistPosition("reg-1", user)).rejects.toThrow(
      /Accès refusé/,
    );
  });

  it("allows an organizer of the event's org", async () => {
    mockRegRepo.findByIdOrThrow.mockResolvedValue(buildReg({ userId: "other-user" }));
    mockEventRepo.findByIdOrThrow.mockResolvedValue({
      id: "event-1",
      organizationId: "org-1",
    });
    mockRegRepo.countWaitlistedOlderThan.mockResolvedValue(0);
    mockRegRepo.countWaitlistedTotal.mockResolvedValue(3);

    const user = buildOrganizerUser("org-1");
    const result = await service.getWaitlistPosition("reg-1", user);
    expect(result).toEqual({ position: 1, total: 3 });
  });
});
