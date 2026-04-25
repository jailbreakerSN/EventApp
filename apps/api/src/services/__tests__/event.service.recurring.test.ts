import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateEventDto, Location } from "@teranga/shared-types";
import { buildOrganizerUser, buildOrganization, buildEvent } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockEventRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  countActiveByOrganization: vi.fn(),
};

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockVenueRepo = {
  findByIdOrThrow: vi.fn(),
  increment: vi.fn(),
};

const mockSubRepo = {
  findByOrganization: vi.fn(),
};

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    { get: (_t, prop) => (mockEventRepo as Record<string, unknown>)[prop as string] },
  ),
}));
vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy(
    {},
    { get: (_t, prop) => (mockOrgRepo as Record<string, unknown>)[prop as string] },
  ),
}));
vi.mock("@/repositories/venue.repository", () => ({
  venueRepository: new Proxy(
    {},
    { get: (_t, prop) => (mockVenueRepo as Record<string, unknown>)[prop as string] },
  ),
}));
vi.mock("@/repositories/subscription.repository", () => ({
  subscriptionRepository: new Proxy(
    {},
    { get: (_t, prop) => (mockSubRepo as Record<string, unknown>)[prop as string] },
  ),
}));
vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));
vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Tracks each call to db.collection(...).doc() so child refs have distinct ids.
let docCallCount = 0;
const mockTxSet = vi.fn();
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockChildrenGet = vi.fn();

vi.mock("@/config/firebase", () => ({
  db: {
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { get: mockTxGet, set: mockTxSet, update: mockTxUpdate };
      return fn(tx);
    }),
    collection: vi.fn(() => ({
      doc: vi.fn((id?: string) => {
        if (id === undefined) {
          docCallCount += 1;
          return { id: `mock-doc-${docCallCount}` };
        }
        return { id };
      }),
      where: vi.fn().mockReturnThis(),
      get: mockChildrenGet,
    })),
  },
  COLLECTIONS: { EVENTS: "events" },
}));

// Import AFTER mocks
import { EventService } from "../event.service";
import { eventBus } from "@/events/event-bus";

const service = new EventService();

function buildRecurringDto(overrides: Partial<CreateEventDto> = {}): CreateEventDto {
  const location: Location = {
    name: "Salle A",
    country: "SN",
    city: "Dakar",
    address: "Rue des Ateliers",
  };
  return {
    organizationId: "org-1",
    title: "Atelier hebdomadaire",
    description: "Atelier récurrent",
    category: "workshop" as CreateEventDto["category"],
    tags: [],
    format: "in_person",
    status: "draft",
    location,
    startDate: "2026-05-01T09:00:00.000Z",
    endDate: "2026-05-01T11:00:00.000Z",
    timezone: "Africa/Dakar",
    ticketTypes: [],
    accessZones: [],
    isPublic: true,
    isFeatured: false,
    requiresApproval: false,
    recurrenceRule: {
      freq: "weekly",
      interval: 1,
      byDay: ["FR"],
      count: 4,
    },
    ...overrides,
  } as CreateEventDto;
}

beforeEach(() => {
  vi.clearAllMocks();
  docCallCount = 0;
  mockOrgRepo.findByIdOrThrow.mockResolvedValue(
    buildOrganization({
      id: "org-1",
      plan: "pro",
      memberIds: ["user-1"],
      effectiveLimits: { maxEvents: -1, maxParticipantsPerEvent: 2000, maxMembers: 50 },
      effectiveFeatures: {
        qrScanning: true,
        paidTickets: true,
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
    }),
  );
  mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
  mockSubRepo.findByOrganization.mockResolvedValue(null);
});

describe("EventService.create — recurring series branch", () => {
  it("creates parent + 4 children in a single transaction", async () => {
    const user = buildOrganizerUser("org-1");
    const result = await service.create(buildRecurringDto(), user);

    expect(result.isRecurringParent).toBe(true);
    expect(result.recurrenceRule).toBeDefined();
    expect(result.parentEventId).toBeNull();
    // 1 parent set + 4 child sets
    expect(mockTxSet).toHaveBeenCalledTimes(5);

    // The series_created event fires with occurrenceCount=4
    expect(eventBus.emit).toHaveBeenCalledWith(
      "event.series_created",
      expect.objectContaining({
        parentEventId: result.id,
        occurrenceCount: 4,
        organizationId: "org-1",
      }),
    );
  });

  it("rejects when the full fan-out exceeds the plan's maxEvents", async () => {
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({
        id: "org-1",
        plan: "free",
        memberIds: ["user-1"],
        effectiveLimits: { maxEvents: 3, maxParticipantsPerEvent: 50, maxMembers: 1 },
        effectiveFeatures: {
          qrScanning: false,
          paidTickets: false,
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
      }),
    );
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    const user = buildOrganizerUser("org-1");

    await expect(service.create(buildRecurringDto(), user)).rejects.toThrow(
      /Maximum 3 événements/,
    );
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it("rejects boundary case where count+parent matches limit exactly", async () => {
    // Free plan, maxEvents=3. count=3 children → 1 parent + 3 children = 4 docs.
    // Must reject even though children alone fit; the parent is the silent 4th slot.
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({
        id: "org-1",
        plan: "free",
        memberIds: ["user-1"],
        effectiveLimits: { maxEvents: 3, maxParticipantsPerEvent: 50, maxMembers: 1 },
        effectiveFeatures: {
          qrScanning: false,
          paidTickets: false,
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
      }),
    );
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    const user = buildOrganizerUser("org-1");
    const dto = buildRecurringDto({
      recurrenceRule: {
        freq: "weekly",
        interval: 1,
        byDay: ["FR"],
        count: 3,
      } as CreateEventDto["recurrenceRule"],
    });

    await expect(service.create(dto, user)).rejects.toThrow(/Maximum 3/);
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it("rejects when a scheduled downgrade would cap the target plan below the fan-out", async () => {
    // Pro org (unlimited events), but a downgrade to starter (maxEvents: 10)
    // is scheduled — the series of 4 plus an existing 8 events would land
    // the org at 13 on starter, which violates the target's cap.
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({
        id: "org-1",
        plan: "pro",
        memberIds: ["user-1"],
        effectiveLimits: { maxEvents: -1, maxParticipantsPerEvent: 2000, maxMembers: 50 },
        effectiveFeatures: {
          qrScanning: true,
          paidTickets: true,
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
      }),
    );
    mockEventRepo.countActiveByOrganization.mockResolvedValue(8);
    mockSubRepo.findByOrganization.mockResolvedValue({
      scheduledChange: { toPlan: "starter" },
    });
    const user = buildOrganizerUser("org-1");

    await expect(service.create(buildRecurringDto(), user)).rejects.toThrow(
      /bascule vers le plan starter/,
    );
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it("rejects when user does not belong to the org", async () => {
    const user = buildOrganizerUser("other-org");
    await expect(service.create(buildRecurringDto(), user)).rejects.toThrow(
      /ne faites pas partie/,
    );
  });

  it("rejects a recurrence rule whose startDate misaligns with byDay", async () => {
    const user = buildOrganizerUser("org-1");
    // Mo 2026-05-04 but byDay=[FR] → misaligned.
    const dto = buildRecurringDto({
      startDate: "2026-05-04T09:00:00.000Z",
      endDate: "2026-05-04T11:00:00.000Z",
      recurrenceRule: { freq: "weekly", interval: 1, byDay: ["FR"], count: 3 } as CreateEventDto["recurrenceRule"],
    });
    await expect(service.create(dto, user)).rejects.toThrow(/filtre de récurrence/);
  });
});

describe("EventService.publishSeries", () => {
  it("publishes parent + all children in one transaction", async () => {
    const user = buildOrganizerUser("org-1");
    const parent = buildEvent({
      id: "parent-1",
      organizationId: "org-1",
      isRecurringParent: true,
      parentEventId: null,
      status: "draft",
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(parent);
    mockChildrenGet.mockResolvedValue({
      size: 3,
      docs: [
        { ref: { id: "c1" } },
        { ref: { id: "c2" } },
        { ref: { id: "c3" } },
      ],
    });

    const result = await service.publishSeries("parent-1", user);

    expect(result.publishedCount).toBe(3);
    // 1 parent update + 3 child updates
    expect(mockTxUpdate).toHaveBeenCalledTimes(4);
    // Parent stays "draft" (anchor only); only children get "published"
    // so the parent never leaks onto participant discovery surfaces.
    const parentCall = mockTxUpdate.mock.calls.find(
      (c) => (c[0] as { id: string }).id === "parent-1",
    );
    expect(parentCall).toBeDefined();
    expect(parentCall![1]).not.toHaveProperty("status");
    expect(parentCall![1]).toHaveProperty("publishedAt");
    // Children get full publish state.
    const childCalls = mockTxUpdate.mock.calls.filter(
      (c) => (c[0] as { id: string }).id !== "parent-1",
    );
    for (const c of childCalls) {
      expect((c[1] as Record<string, unknown>).status).toBe("published");
    }
    expect(eventBus.emit).toHaveBeenCalledWith(
      "event.series_published",
      expect.objectContaining({ parentEventId: "parent-1", publishedCount: 3 }),
    );
  });

  it("rejects when the target event isn't a recurring parent", async () => {
    const user = buildOrganizerUser("org-1");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(
      buildEvent({ id: "parent-1", organizationId: "org-1", isRecurringParent: false }),
    );

    await expect(service.publishSeries("parent-1", user)).rejects.toThrow(
      /parent d'une série/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("rejects when user lacks event:publish permission", async () => {
    // Buildaauth as a participant (no event:publish permission).
    const user = buildOrganizerUser("org-1");
    const noPublish = { ...user, roles: ["participant"] as typeof user.roles };
    await expect(service.publishSeries("parent-1", noPublish)).rejects.toThrow(
      /Permission manquante/,
    );
  });
});

// Sprint-2 S1 closure — bulk cancel a recurring series.
describe("EventService.cancelSeries", () => {
  it("cancels parent + all non-already-cancelled children atomically", async () => {
    const user = buildOrganizerUser("org-1");
    const parent = buildEvent({
      id: "parent-1",
      organizationId: "org-1",
      isRecurringParent: true,
      parentEventId: null,
      status: "published",
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(parent);
    // Sprint-2 review fix — children read moved INSIDE the
    // transaction. The mock now drives `mockTxGet` instead of the
    // outside-tx `mockChildrenGet` (which is no longer hit by the
    // happy path).
    mockTxGet.mockResolvedValue({
      size: 4,
      docs: [
        { id: "c1", ref: { id: "c1" }, data: () => ({ status: "published" }) },
        { id: "c2", ref: { id: "c2" }, data: () => ({ status: "draft" }) },
        // Already cancelled — should be skipped.
        { id: "c3", ref: { id: "c3" }, data: () => ({ status: "cancelled" }) },
        // Already archived — should be skipped.
        { id: "c4", ref: { id: "c4" }, data: () => ({ status: "archived" }) },
      ],
    });

    const result = await service.cancelSeries("parent-1", user);

    expect(result.parentEventId).toBe("parent-1");
    expect(result.cancelledCount).toBe(2); // c1 + c2 only
    // 1 parent + 2 children = 3 transactional updates.
    expect(mockTxUpdate).toHaveBeenCalledTimes(3);
    const allCalls = mockTxUpdate.mock.calls;
    for (const call of allCalls) {
      expect((call[1] as Record<string, unknown>).status).toBe("cancelled");
    }
    expect(eventBus.emit).toHaveBeenCalledWith(
      "event.series_cancelled",
      expect.objectContaining({
        parentEventId: "parent-1",
        cancelledCount: 2,
        cancelledChildIds: ["c1", "c2"],
      }),
    );
  });

  it("rejects when the target event isn't a recurring parent", async () => {
    const user = buildOrganizerUser("org-1");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(
      buildEvent({ id: "parent-1", organizationId: "org-1", isRecurringParent: false }),
    );

    await expect(service.cancelSeries("parent-1", user)).rejects.toThrow(
      /parent d'une série/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("rejects callers without event:update", async () => {
    const user = buildOrganizerUser("org-1");
    const noUpdate = { ...user, roles: ["participant"] as typeof user.roles };
    await expect(service.cancelSeries("parent-1", noUpdate)).rejects.toThrow(
      /Permission manquante/,
    );
  });
});
