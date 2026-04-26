import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventService } from "../event.service";
import {
  type CreateEventDto,
  type UpdateEventDto,
  type CreateTicketTypeDto,
  type Location,
  type TicketType,
} from "@teranga/shared-types";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildSuperAdmin,
  buildEvent,
  buildOrganization,
} from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockEventRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findBySlug: vi.fn(),
  findPublished: vi.fn(),
  findByOrganization: vi.fn(),
  countActiveByOrganization: vi.fn(),
  search: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  softDelete: vi.fn(),
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

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockOrgRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/venue.repository", () => ({
  venueRepository: {
    findByIdOrThrow: vi.fn(),
    increment: vi.fn(),
  },
}));

// Scheduled-downgrade freeze (Q2a): `checkEventLimit` now reads the
// subscription to apply the target-plan cap as soon as a downgrade is
// scheduled. Default: no scheduled change. Tests exercising the
// scheduled-downgrade spec override `findByOrganization` per-test.
const { mockSubRepo } = vi.hoisted(() => ({
  mockSubRepo: { findByOrganization: vi.fn() },
}));
vi.mock("@/repositories/subscription.repository", () => ({
  subscriptionRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockSubRepo as Record<string, unknown>)[p as string],
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

// Mock db for transactional ticket type operations
const mockTxUpdate = vi.fn();
const mockTxGet = vi.fn();
const mockTxSet = vi.fn();
const mockDocRef = { id: "mock-doc" };
// Counter so each .doc() call inside createSeries gets a fresh id —
// avoids accidental dedup in test assertions that rely on unique child refs.
let docCallCount = 0;
const mockChildrenGet = vi.fn();

vi.mock("@/config/firebase", () => ({
  db: {
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { get: mockTxGet, update: mockTxUpdate, set: mockTxSet };
      return fn(tx);
    }),
    collection: vi.fn(() => ({
      // Pre-existing ticket-type tests assert `{ id: "mock-doc" }`, so we
      // preserve the old behaviour (ignore the id arg) on explicit-id calls.
      // Auto-id calls (createSeries) get fresh ids so child refs don't dedup.
      doc: vi.fn((id?: string) => {
        if (id === undefined) {
          docCallCount += 1;
          return { id: `mock-doc-${docCallCount}` };
        }
        return mockDocRef;
      }),
      where: vi.fn().mockReturnThis(),
      get: mockChildrenGet,
    })),
  },
  COLLECTIONS: { EVENTS: "events" },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new EventService();

beforeEach(() => {
  vi.clearAllMocks();
  // Default: org has room for more events (below plan limit)
  mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
  // Default: no scheduled downgrade. Scheduled-downgrade freeze tests
  // override this per-test to simulate a pending plan flip.
  mockSubRepo.findByOrganization.mockResolvedValue(null);
});

describe("EventService.create", () => {
  const org = buildOrganization({ id: "org-1" });

  it("creates an event and emits domain event", async () => {
    const user = buildOrganizerUser("org-1");
    const dto = {
      organizationId: "org-1",
      title: "Teranga Fest",
      description: "An awesome event",
      category: "conference" as const,
      format: "in_person" as const,
      status: "draft" as const,
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      timezone: "Africa/Dakar",
      location: { name: "CICAD", address: "Diamniadio", city: "Dakar", country: "SN" },
      isPublic: true,
      isFeatured: false,
      requiresApproval: false,
      ticketTypes: [],
      accessZones: [],
      tags: [],
      maxAttendees: null,
      shortDescription: null,
      coverImageURL: null,
      bannerImageURL: null,
      templateId: null,
    };

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    const createdEvent = buildEvent({ organizationId: "org-1", title: "Teranga Fest" });
    mockEventRepo.create.mockResolvedValue(createdEvent);

    const result = await service.create(dto, user);

    expect(result.title).toBe("Teranga Fest");
    expect(mockEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        slug: expect.stringMatching(/^teranga-fest-[a-f0-9]{6}$/),
        registeredCount: 0,
        checkedInCount: 0,
        createdBy: user.uid,
      }),
    );
  });

  it("rejects participant without event:create permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const dto = { organizationId: "org-1", title: "Test" } as unknown as CreateEventDto;

    await expect(service.create(dto, user)).rejects.toThrow("Permission manquante");
  });

  it("computes accent-folded searchKeywords[] from title, tags, and location on create", async () => {
    const user = buildOrganizerUser("org-1");
    const dto = {
      organizationId: "org-1",
      title: "Conférence Sénégal Tech",
      description: "n/a",
      category: "conference" as const,
      format: "in_person" as const,
      status: "draft" as const,
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      timezone: "Africa/Dakar",
      location: { name: "CICAD", address: "Diamniadio", city: "Thiès", country: "SN" },
      isPublic: true,
      isFeatured: false,
      requiresApproval: false,
      ticketTypes: [],
      accessZones: [],
      tags: ["fintech"],
      maxAttendees: null,
      shortDescription: null,
      coverImageURL: null,
      bannerImageURL: null,
      templateId: null,
    };

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockEventRepo.create.mockResolvedValue(buildEvent({ organizationId: "org-1" }));

    await service.create(dto as unknown as CreateEventDto, user);

    const createCall = mockEventRepo.create.mock.calls[0]?.[0] as { searchKeywords: string[] };
    expect(createCall.searchKeywords).toEqual(expect.arrayContaining(["co", "con", "conf", "conference"]));
    expect(createCall.searchKeywords).toEqual(expect.arrayContaining(["se", "senegal"]));
    expect(createCall.searchKeywords).toEqual(expect.arrayContaining(["fi", "fintech"]));
    expect(createCall.searchKeywords).toEqual(expect.arrayContaining(["th", "thies"]));
    expect(createCall.searchKeywords).toEqual(expect.arrayContaining(["sn"]));
    // Cap respected
    expect(createCall.searchKeywords.length).toBeLessThanOrEqual(200);
  });

  it("rejects if user does not belong to the organization", async () => {
    const user = buildOrganizerUser("org-other");
    const dto = {
      organizationId: "org-1",
      title: "Test",
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    } as unknown as CreateEventDto;

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);

    await expect(service.create(dto, user)).rejects.toThrow("ne faites pas partie");
  });

  it("allows super_admin to create event for any org", async () => {
    const admin = buildSuperAdmin();
    const dto = {
      organizationId: "org-1",
      title: "Admin Event",
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    } as unknown as CreateEventDto;

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockEventRepo.create.mockResolvedValue(buildEvent({ title: "Admin Event" }));

    const result = await service.create(dto, admin);
    expect(result.title).toBe("Admin Event");
  });

  it("rejects when endDate is before startDate", async () => {
    const user = buildOrganizerUser("org-1");
    const dto = {
      organizationId: "org-1",
      title: "Bad Dates",
      startDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
    } as unknown as CreateEventDto;

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);

    await expect(service.create(dto, user)).rejects.toThrow("La date de fin");
  });
});

describe("EventService.getById", () => {
  it("returns published public event without auth", async () => {
    const event = buildEvent({ status: "published", isPublic: true });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    const result = await service.getById(event.id);
    expect(result.id).toBe(event.id);
  });

  it("rejects unauthenticated access to draft event", async () => {
    const event = buildEvent({ status: "draft", isPublic: false });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.getById(event.id)).rejects.toThrow("Authentification requise");
  });

  it("allows organizer to view draft event in their org", async () => {
    const event = buildEvent({ status: "draft", isPublic: false, organizationId: "org-1" });
    const user = buildOrganizerUser("org-1");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    const result = await service.getById(event.id, user);
    expect(result.id).toBe(event.id);
  });

  it("rejects organizer viewing draft event in another org", async () => {
    const event = buildEvent({ status: "draft", isPublic: false, organizationId: "org-other" });
    const user = buildOrganizerUser("org-1");
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.getById(event.id, user)).rejects.toThrow("Accès refusé");
  });
});

// ─── SPEC: scheduled-downgrade event-creation freeze (Q2a, post-audit) ───
// Pre-audit, once an organizer scheduled a downgrade (e.g. pro → starter)
// they could keep creating events up to the CURRENT plan's cap during
// the scheduled window. At rollover, the daily job saw `current > target`
// and silently refused to flip, leaving the org on the old plan forever.
// Spec: when a downgrade is scheduled, the TARGET plan's cap applies
// immediately — the organizer loses the extra headroom the moment they
// schedule the flip, preventing the stranded-scheduled-change state.
describe("EventService.create — scheduled-downgrade freeze (spec)", () => {
  it("blocks event creation when active-event count >= target plan cap", async () => {
    const user = buildOrganizerUser("org-1");
    const org = buildOrganization({ id: "org-1", plan: "pro" });
    // Pro allows unlimited events; org currently has 15 active.
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(15);
    // Scheduled downgrade to starter (max 10 events) → new creates
    // must reject because we're already above the target cap.
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      scheduledChange: {
        toPlan: "starter",
        effectiveAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        reason: "downgrade",
        scheduledBy: "user-1",
        scheduledAt: new Date().toISOString(),
      },
    });

    const dto = {
      organizationId: "org-1",
      title: "Blocked event",
      description: "should not land",
      category: "conference" as const,
      format: "in_person" as const,
      status: "draft" as const,
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      timezone: "Africa/Dakar",
      location: { name: "X", address: "Y", city: "Dakar", country: "SN" },
      isPublic: true,
      isFeatured: false,
      requiresApproval: false,
      maxAttendees: 100,
      tags: [],
      ticketTypes: [
        {
          id: "t1",
          name: "Standard",
          price: 0,
          currency: "XOF" as const,
          totalQuantity: 100,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      accessZones: [],
    } as unknown as CreateEventDto;

    await expect(service.create(dto, user)).rejects.toThrow(/bascule vers le plan starter/);
    expect(mockEventRepo.create).not.toHaveBeenCalled();
  });

  it("allows creation when active-event count is below the target plan cap", async () => {
    // Current usage is 3, scheduled target is starter (cap 10). Still
    // within target — creation should succeed. Makes sure the freeze
    // isn't over-aggressive and doesn't block legitimate activity.
    const user = buildOrganizerUser("org-1");
    const org = buildOrganization({ id: "org-1", plan: "pro" });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(3);
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      scheduledChange: {
        toPlan: "starter",
        effectiveAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        reason: "downgrade",
        scheduledBy: "user-1",
        scheduledAt: new Date().toISOString(),
      },
    });
    mockEventRepo.create.mockResolvedValue(buildEvent({ id: "ev-ok" }));

    const dto = {
      organizationId: "org-1",
      title: "Allowed event",
      description: "fits target",
      category: "conference" as const,
      format: "in_person" as const,
      status: "draft" as const,
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      timezone: "Africa/Dakar",
      location: { name: "X", address: "Y", city: "Dakar", country: "SN" },
      isPublic: true,
      isFeatured: false,
      requiresApproval: false,
      maxAttendees: 100,
      tags: [],
      ticketTypes: [
        {
          id: "t1",
          name: "Standard",
          price: 0,
          currency: "XOF" as const,
          totalQuantity: 100,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      accessZones: [],
    } as unknown as CreateEventDto;

    await expect(service.create(dto, user)).resolves.toBeDefined();
    expect(mockEventRepo.create).toHaveBeenCalled();
  });
});

describe("EventService.update", () => {
  it("updates event and emits domain event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockEventRepo.update.mockResolvedValue(undefined);

    await service.update(event.id, { title: "Updated Title" } as unknown as UpdateEventDto, user);

    expect(mockEventRepo.update).toHaveBeenCalledWith(
      event.id,
      expect.objectContaining({ title: "Updated Title", updatedBy: user.uid }),
    );
  });

  it("rejects update on cancelled event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "cancelled" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.update(event.id, { title: "Nope" } as unknown as UpdateEventDto, user),
    ).rejects.toThrow("Cannot update an event with status 'cancelled'");
  });

  it("rejects update on archived event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "archived" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.update(event.id, { title: "Nope" } as unknown as UpdateEventDto, user),
    ).rejects.toThrow("Cannot update an event with status 'archived'");
  });

  it("validates date consistency on update", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      status: "draft",
      startDate: "2026-06-01T00:00:00Z",
      endDate: "2026-06-02T00:00:00Z",
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.update(
        event.id,
        { endDate: "2026-05-01T00:00:00Z" } as unknown as UpdateEventDto,
        user,
      ),
    ).rejects.toThrow("La date de fin");
  });

  it("rejects if user doesn't belong to event's org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ organizationId: "org-1", status: "draft" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.update(event.id, { title: "Nope" } as unknown as UpdateEventDto, user),
    ).rejects.toThrow("Accès refusé");
  });

  it("emits BOTH event.updated and event.rescheduled when startDate changes", async () => {
    // Phase 2 notification split: rescheduling must fire a dedicated
    // `event.rescheduled` event alongside the generic `event.updated`.
    // The notification dispatcher subscribes to the former for template
    // routing; the latter still fires for audit + denorm fan-out.
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      status: "published",
      startDate: "2026-06-01T09:00:00.000Z",
      endDate: "2026-07-01T18:00:00.000Z",
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockEventRepo.update.mockResolvedValue(undefined);

    await service.update(
      event.id,
      { startDate: "2026-06-15T09:00:00.000Z" } as unknown as UpdateEventDto,
      user,
    );

    const emittedEventNames = mockEventEmit.mock.calls.map((c) => c[0]);
    expect(emittedEventNames).toContain("event.updated");
    expect(emittedEventNames).toContain("event.rescheduled");

    const rescheduledCall = mockEventEmit.mock.calls.find(
      (c) => c[0] === "event.rescheduled",
    );
    expect(rescheduledCall![1]).toMatchObject({
      eventId: event.id,
      organizationId: "org-1",
      previousStartDate: "2026-06-01T09:00:00.000Z",
      newStartDate: "2026-06-15T09:00:00.000Z",
    });
  });

  it("does NOT emit event.rescheduled when only the title changes", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "published" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockEventRepo.update.mockResolvedValue(undefined);

    await service.update(
      event.id,
      { title: "Renamed" } as unknown as UpdateEventDto,
      user,
    );

    const emittedEventNames = mockEventEmit.mock.calls.map((c) => c[0]);
    expect(emittedEventNames).toContain("event.updated");
    expect(emittedEventNames).not.toContain("event.rescheduled");
  });
});

describe("EventService.publish", () => {
  it("publishes a draft event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      status: "draft",
      title: "Ready Event",
      location: { name: "CICAD", address: "Diamniadio", city: "Dakar", country: "SN" },
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockEventRepo.publish.mockResolvedValue(undefined);

    await service.publish(event.id, user);

    expect(mockEventRepo.publish).toHaveBeenCalledWith(event.id, user.uid);
  });

  it("rejects publishing an already published event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "published" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.publish(event.id, user)).rejects.toThrow(
      "Only draft events can be published",
    );
  });

  it("rejects publishing an incomplete event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      status: "draft",
      location: null as unknown as Location,
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.publish(event.id, user)).rejects.toThrow("titre, des dates et un lieu");
  });
});

describe("EventService.cancel", () => {
  it("cancels a published event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "published" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockEventRepo.update.mockResolvedValue(undefined);

    await service.cancel(event.id, user);

    expect(mockEventRepo.update).toHaveBeenCalledWith(
      event.id,
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("rejects cancelling an already cancelled event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "cancelled" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.cancel(event.id, user)).rejects.toThrow("already cancelled");
  });
});

describe("EventService.archive", () => {
  it("archives an event with status + archivedAt timestamp", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "published" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockEventRepo.update.mockResolvedValue(undefined);

    await service.archive(event.id, user);

    // T2.2 closure — archive now stamps `archivedAt` so the
    // restore window can be enforced.
    expect(mockEventRepo.update).toHaveBeenCalledWith(
      event.id,
      expect.objectContaining({ status: "archived", archivedAt: expect.any(String) }),
    );
  });

  it("requires event:delete permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const event = buildEvent();
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.archive(event.id, user)).rejects.toThrow("Permission manquante");
  });
});

// T2.2 closure — restore endpoint contract tests.
//
// Sprint-2 review hardening: `restore` now wraps the read-then-write
// in `db.runTransaction(...)` and re-checks plan limits. The tests
// drive both paths via the shared `mockTxGet` / `mockTxUpdate`
// fixtures.
describe("EventService.restore", () => {
  const buildOrgWithRoom = () =>
    buildOrganization({
      id: "org-1",
      // Room for many events so checkEventLimit doesn't throw in the
      // happy path. plan: pro has -1 (unlimited).
      plan: "pro",
    });

  it("restores an archived event within the 30-day window to draft status", async () => {
    const user = buildOrganizerUser("org-1");
    const archivedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
    const event = buildEvent({
      id: "evt-restore-1",
      organizationId: "org-1",
      status: "archived",
      archivedAt,
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrgWithRoom());
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    // tx.get(ref) returns the same archived row.
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => event });

    const result = await service.restore(event.id, user);

    expect(result).toEqual({ eventId: event.id });
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "draft", archivedAt: null }),
    );
  });

  it("rejects restoring a non-archived event (e.g. cancelled)", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "cancelled" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrgWithRoom());
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => event });

    await expect(service.restore(event.id, user)).rejects.toThrow(
      /Seuls les événements archivés peuvent être restaurés/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("rejects restoring an event archived more than 30 days ago", async () => {
    const user = buildOrganizerUser("org-1");
    const archivedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const event = buildEvent({
      organizationId: "org-1",
      status: "archived",
      archivedAt,
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrgWithRoom());
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => event });

    await expect(service.restore(event.id, user)).rejects.toThrow(
      /Fenêtre de restauration dépassée/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("rejects restoring a legacy archived event without archivedAt", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      status: "archived",
      archivedAt: null,
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrgWithRoom());
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    mockTxGet.mockResolvedValueOnce({ exists: true, data: () => event });

    await expect(service.restore(event.id, user)).rejects.toThrow(
      /archivé avant l'introduction de la fenêtre/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("requires event:delete permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    await expect(service.restore("evt-1", user)).rejects.toThrow("Permission manquante");
  });

  // Sprint-2 review fix — restore must re-check `maxEvents` so a
  // free-tier organizer who archived to free a slot, created a new
  // event, and then tried to restore the old one is refused.
  it("refuses when restoring would push the org over its plan's maxEvents", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      status: "archived",
      archivedAt: new Date().toISOString(),
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({ id: "org-1", plan: "free" }),
    );
    // Free plan caps at 3 active events; 3 already active means
    // restore would push to 4.
    mockEventRepo.countActiveByOrganization.mockResolvedValue(3);

    await expect(service.restore(event.id, user)).rejects.toThrow(/limite|plan/i);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });
});

describe("EventService.unpublish", () => {
  it("unpublishes a published event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "published" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockEventRepo.unpublish.mockResolvedValue(undefined);

    await service.unpublish(event.id, user);

    expect(mockEventRepo.unpublish).toHaveBeenCalledWith(event.id, user.uid);
  });

  it("rejects unpublishing a draft event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.unpublish(event.id, user)).rejects.toThrow(
      "Only published events can be unpublished",
    );
  });

  it("requires event:publish permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.unpublish("ev-1", user)).rejects.toThrow("Permission manquante");
  });
});

describe("EventService.addTicketType", () => {
  it("adds a ticket type to an event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft", ticketTypes: [] });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    // Pro plan required for paid tickets
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrganization({ id: "org-1", plan: "pro" }));

    const result = await service.addTicketType(
      event.id,
      {
        name: "VIP",
        price: 5000,
        currency: "XOF",
        totalQuantity: 50,
        accessZoneIds: [],
        isVisible: true,
      },
      user,
    );

    expect(result.ticketTypes).toHaveLength(1);
    expect(result.ticketTypes[0].name).toBe("VIP");
    expect(result.ticketTypes[0].soldCount).toBe(0);
    expect(result.ticketTypes[0].id).toMatch(/^tt-/);
    expect(mockTxUpdate).toHaveBeenCalled();
  });

  it("rejects adding to a cancelled event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "cancelled" });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    await expect(
      service.addTicketType(event.id, { name: "VIP" } as unknown as CreateTicketTypeDto, user),
    ).rejects.toThrow("Cannot modify ticket types");
  });
});

describe("EventService.updateTicketType", () => {
  it("updates a ticket type successfully", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      ticketTypes: [
        {
          id: "tt-1",
          name: "Standard",
          price: 0,
          currency: "XOF" as const,
          totalQuantity: 100,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    const result = await service.updateTicketType(
      event.id,
      "tt-1",
      { name: "VIP", price: 5000 },
      user,
    );

    expect(result.ticketTypes[0].name).toBe("VIP");
    expect(result.ticketTypes[0].price).toBe(5000);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({ updatedBy: user.uid }),
    );
  });

  it("rejects updating a non-existent ticket type", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", ticketTypes: [] });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    await expect(
      service.updateTicketType(event.id, "tt-999", { name: "Nope" }, user),
    ).rejects.toThrow("introuvable");
  });

  it("rejects if user doesn't belong to event's org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({
      organizationId: "org-1",
      ticketTypes: [
        {
          id: "tt-1",
          name: "Standard",
          price: 0,
          currency: "XOF" as const,
          totalQuantity: 100,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    await expect(service.updateTicketType(event.id, "tt-1", { name: "VIP" }, user)).rejects.toThrow(
      "Accès refusé",
    );
  });
});

describe("EventService.removeTicketType", () => {
  it("removes a ticket type with zero sales", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      ticketTypes: [
        {
          id: "tt-1",
          name: "Standard",
          price: 0,
          currency: "XOF" as const,
          totalQuantity: 100,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    await service.removeTicketType(event.id, "tt-1", user);

    expect(mockTxUpdate).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({ ticketTypes: [] }),
    );
  });

  it("rejects removing a ticket type with sales", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      ticketTypes: [
        {
          id: "tt-1",
          name: "Standard",
          price: 0,
          currency: "XOF" as const,
          totalQuantity: 100,
          soldCount: 5,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    await expect(service.removeTicketType(event.id, "tt-1", user)).rejects.toThrow(
      "ventes existantes",
    );
  });

  it("rejects removing a non-existent ticket type", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", ticketTypes: [] });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    await expect(service.removeTicketType(event.id, "tt-999", user)).rejects.toThrow("introuvable");
  });
});

describe("EventService.search", () => {
  it("delegates to repository search", async () => {
    const events = [buildEvent(), buildEvent()];
    mockEventRepo.search.mockResolvedValue({
      data: events,
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });

    const result = await service.search({
      page: 1,
      limit: 20,
      orderBy: "startDate",
      orderDir: "asc",
      category: "conference",
    });

    expect(result.data).toHaveLength(2);
    expect(mockEventRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({ category: "conference" }),
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it("passes city, country, and tags filters to repository", async () => {
    mockEventRepo.search.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await service.search({
      city: "Dakar",
      country: "SN",
      tags: "tech,startup",
      page: 1,
      limit: 20,
      orderBy: "startDate",
      orderDir: "asc",
    });

    expect(mockEventRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({
        city: "Dakar",
        country: "SN",
        tags: ["tech", "startup"],
      }),
      expect.any(Object),
    );
  });

  it("derives searchToken from q and forwards it to the repository", async () => {
    mockEventRepo.search.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await service.search({
      q: "teranga",
      page: 1,
      limit: 20,
      orderBy: "startDate",
      orderDir: "asc",
    });

    expect(mockEventRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({ searchToken: "teranga" }),
      expect.any(Object),
    );
  });

  it("normalises q (accent-folding + lowercase) before forwarding searchToken", async () => {
    mockEventRepo.search.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await service.search({
      q: "Sénégal",
      page: 1,
      limit: 20,
      orderBy: "startDate",
      orderDir: "asc",
    });

    expect(mockEventRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({ searchToken: "senegal" }),
      expect.any(Object),
    );
  });

  it("omits searchToken when q is empty / whitespace-only", async () => {
    mockEventRepo.search.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await service.search({
      q: "   ",
      page: 1,
      limit: 20,
      orderBy: "startDate",
      orderDir: "asc",
    });

    const filtersArg = mockEventRepo.search.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(filtersArg.searchToken).toBeUndefined();
  });

  it("clamps long search tokens to the 15-char prefix index width", async () => {
    mockEventRepo.search.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await service.search({
      q: "supercalifragilisticexpialidocious",
      page: 1,
      limit: 20,
      orderBy: "startDate",
      orderDir: "asc",
    });

    expect(mockEventRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({ searchToken: "supercalifragil" }),
      expect.any(Object),
    );
  });

  it("propagates meta.warnings from the repository to the caller (P0.5)", async () => {
    mockEventRepo.search.mockResolvedValue({
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        warnings: ["TAGS_TRUNCATED:30 (received 42)"],
      },
    });

    const result = await service.search({
      tags: Array.from({ length: 42 }, (_, i) => `tag-${i}`),
      page: 1,
      limit: 20,
      orderBy: "startDate",
      orderDir: "asc",
    });

    expect(result.meta.warnings).toEqual(["TAGS_TRUNCATED:30 (received 42)"]);
  });

  describe("price filter", () => {
    const ticket = (overrides: Partial<TicketType>): TicketType => ({
      id: overrides.id ?? "tt",
      name: overrides.name ?? "Standard",
      price: overrides.price ?? 0,
      currency: "XOF",
      totalQuantity: 100,
      soldCount: 0,
      accessZoneIds: [],
      isVisible: true,
      ...overrides,
    });

    const freeEvt = buildEvent({
      title: "Free Workshop",
      ticketTypes: [ticket({ id: "t1", price: 0 })],
    });
    const paidEvt = buildEvent({
      title: "Paid Conference",
      ticketTypes: [ticket({ id: "t2", price: 5000 })],
    });
    const mixedEvt = buildEvent({
      title: "Mixed",
      ticketTypes: [
        ticket({ id: "t3", name: "VIP", price: 10000 }),
        ticket({ id: "t4", name: "Free seat", price: 0 }),
      ],
    });
    const noTicketEvt = buildEvent({ title: "No tickets yet", ticketTypes: [] });

    it("price=free keeps events with at least one zero-priced ticket and ticketless events", async () => {
      mockEventRepo.search.mockResolvedValue({
        data: [freeEvt, paidEvt, mixedEvt, noTicketEvt],
        meta: { page: 1, limit: 20, total: 4, totalPages: 1 },
      });

      const result = await service.search({
        price: "free",
        page: 1,
        limit: 20,
        orderBy: "startDate",
        orderDir: "asc",
      });

      expect(result.data.map((e) => e.title)).toEqual([
        "Free Workshop",
        "Mixed",
        "No tickets yet",
      ]);
      expect(result.meta.total).toBe(3);
    });

    it("price=paid keeps only events whose ticket types are all priced", async () => {
      mockEventRepo.search.mockResolvedValue({
        data: [freeEvt, paidEvt, mixedEvt, noTicketEvt],
        meta: { page: 1, limit: 20, total: 4, totalPages: 1 },
      });

      const result = await service.search({
        price: "paid",
        page: 1,
        limit: 20,
        orderBy: "startDate",
        orderDir: "asc",
      });

      expect(result.data.map((e) => e.title)).toEqual(["Paid Conference"]);
      expect(result.meta.total).toBe(1);
    });

    it("absent price filter leaves results untouched", async () => {
      mockEventRepo.search.mockResolvedValue({
        data: [freeEvt, paidEvt],
        meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
      });

      const result = await service.search({
        page: 1,
        limit: 20,
        orderBy: "startDate",
        orderDir: "asc",
      });

      expect(result.data).toHaveLength(2);
    });
  });
});

describe("EventService.clone", () => {
  const freeOrg = buildOrganization({ id: "org-1", plan: "free" });

  beforeEach(() => {
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(freeOrg);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
  });

  it("clones an event with new dates", async () => {
    const user = buildOrganizerUser("org-1");
    const source = buildEvent({
      organizationId: "org-1",
      title: "Original Event",
      ticketTypes: [
        {
          id: "tt-1",
          name: "Standard",
          price: 0,
          currency: "XOF",
          totalQuantity: 100,
          soldCount: 50,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      accessZones: [
        { id: "zone-1", name: "VIP", color: "#FF0000", allowedTicketTypes: ["tt-1"], capacity: 20 },
      ],
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);

    const clonedEvent = buildEvent({
      id: "cloned-1",
      title: "Original Event (copie)",
      organizationId: "org-1",
    });
    mockEventRepo.create.mockResolvedValue(clonedEvent);

    const newStart = new Date(Date.now() + 30 * 86400000).toISOString();
    const newEnd = new Date(Date.now() + 31 * 86400000).toISOString();

    await service.clone(
      source.id,
      {
        newStartDate: newStart,
        newEndDate: newEnd,
        copyTicketTypes: true,
        copyAccessZones: true,
      },
      user,
    );

    expect(mockEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        registeredCount: 0,
        checkedInCount: 0,
        startDate: newStart,
        endDate: newEnd,
        publishedAt: null,
        isFeatured: false,
      }),
    );

    // Verify ticket types have new IDs and reset counts
    const createCall = mockEventRepo.create.mock.calls[0][0];
    expect(createCall.ticketTypes).toHaveLength(1);
    expect(createCall.ticketTypes[0].id).not.toBe("tt-1");
    expect(createCall.ticketTypes[0].id).toMatch(/^tt-/);
    expect(createCall.ticketTypes[0].soldCount).toBe(0);
    expect(createCall.ticketTypes[0].name).toBe("Standard");

    // Verify access zones have new IDs
    expect(createCall.accessZones).toHaveLength(1);
    expect(createCall.accessZones[0].id).not.toBe("zone-1");
    expect(createCall.accessZones[0].id).toMatch(/^zone-/);
    expect(createCall.accessZones[0].name).toBe("VIP");
  });

  it("uses custom title when provided", async () => {
    const user = buildOrganizerUser("org-1");
    const source = buildEvent({ organizationId: "org-1", title: "Original" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);
    mockEventRepo.create.mockResolvedValue(buildEvent());

    await service.clone(
      source.id,
      {
        newTitle: "Custom Clone",
        newStartDate: new Date(Date.now() + 86400000).toISOString(),
        newEndDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        copyTicketTypes: true,
        copyAccessZones: true,
      },
      user,
    );

    expect(mockEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Custom Clone" }),
    );
  });

  it("rejects clone if end date is before start date", async () => {
    const user = buildOrganizerUser("org-1");
    const source = buildEvent({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);

    await expect(
      service.clone(
        source.id,
        {
          newStartDate: "2026-06-01T00:00:00.000Z",
          newEndDate: "2026-05-01T00:00:00.000Z",
          copyTicketTypes: true,
          copyAccessZones: true,
        },
        user,
      ),
    ).rejects.toThrow("La date de fin");
  });

  it("rejects clone for user without org access", async () => {
    const user = buildOrganizerUser("other-org");
    const source = buildEvent({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);

    await expect(
      service.clone(
        source.id,
        {
          newStartDate: new Date(Date.now() + 86400000).toISOString(),
          newEndDate: new Date(Date.now() + 2 * 86400000).toISOString(),
          copyTicketTypes: true,
          copyAccessZones: true,
        },
        user,
      ),
    ).rejects.toThrow("Accès refusé");
  });

  it("skips ticket types and zones when options are false", async () => {
    const user = buildOrganizerUser("org-1");
    const source = buildEvent({
      organizationId: "org-1",
      ticketTypes: [
        {
          id: "tt-1",
          name: "Standard",
          price: 0,
          currency: "XOF",
          totalQuantity: 100,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      accessZones: [
        { id: "zone-1", name: "VIP", color: "#FF0000", allowedTicketTypes: [], capacity: null },
      ],
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);
    mockEventRepo.create.mockResolvedValue(buildEvent());

    await service.clone(
      source.id,
      {
        newStartDate: new Date(Date.now() + 86400000).toISOString(),
        newEndDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        copyTicketTypes: false,
        copyAccessZones: false,
      },
      user,
    );

    const createCall = mockEventRepo.create.mock.calls[0][0];
    expect(createCall.ticketTypes).toHaveLength(0);
    expect(createCall.accessZones).toHaveLength(0);
  });
});

describe("EventService.rotateQrKey", () => {
  it("rotates the kid inside a transaction and appends the previous one to history", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      id: "ev-1",
      organizationId: "org-1",
      qrKid: "oldkid01",
      qrKidHistory: [{ kid: "older000", retiredAt: "2026-04-01T00:00:00.000Z" }],
    });

    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    const result = await service.rotateQrKey(event.id, user);

    expect(result.qrKid).toMatch(/^[0-9a-z]{4,16}$/);
    expect(result.qrKid).not.toBe("oldkid01");

    // One transactional update, no repository-level update (the old
    // non-atomic path would have hit eventRepo.update).
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    const [, writePayload] = mockTxUpdate.mock.calls[0];
    expect(writePayload.qrKid).toBe(result.qrKid);
    expect(writePayload.qrKidHistory).toHaveLength(2);
    expect(writePayload.qrKidHistory[1].kid).toBe("oldkid01");
    expect(writePayload.updatedBy).toBe(user.uid);
    // Dedicated event so auditLogs can distinguish the rotation.
    const rotated = mockEventEmit.mock.calls.find((c) => c[0] === "event.qr_key_rotated");
    expect(rotated).toBeDefined();
    const payload = rotated![1] as Record<string, unknown>;
    expect(payload.newKid).toBe(result.qrKid);
    expect(payload.previousKid).toBe("oldkid01");
    expect(payload.eventId).toBe(event.id);
  });

  it("rejects rotation from a user outside the event's org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1", qrKid: "oldkid01" });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    await expect(service.rotateQrKey(event.id, user)).rejects.toThrow("Accès refusé");
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("rejects rotation without event:update permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.rotateQrKey("ev-1", user)).rejects.toThrow("Permission manquante");
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });
});

describe("EventService.setScanPolicy", () => {
  // Multi-entry policies are gated behind `advancedAnalytics` (pro+).
  // Each test sets the org plan explicitly so the gate under test is
  // the one we want to exercise.
  const proOrg = buildOrganization({ id: "org-1", plan: "pro" });
  const freeOrg = buildOrganization({ id: "org-1", plan: "free" });

  it("flips the policy and emits event.updated with the before/after", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1", scanPolicy: "single" });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(proOrg);

    const result = await service.setScanPolicy(event.id, "multi_day", user);

    expect(result.scanPolicy).toBe("multi_day");
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    const [, payload] = mockTxUpdate.mock.calls[0];
    expect(payload.scanPolicy).toBe("multi_day");

    const updatedEmit = mockEventEmit.mock.calls.find((c) => c[0] === "event.updated");
    expect(updatedEmit).toBeDefined();
    const changes = (updatedEmit![1] as Record<string, unknown>).changes as Record<string, unknown>;
    expect(changes.scanPolicy).toBe("multi_day");
    expect(changes.previousScanPolicy).toBe("single");
  });

  it("no-ops (no write, no event) when the policy matches the current value", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1", scanPolicy: "multi_zone" });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(proOrg);

    const result = await service.setScanPolicy(event.id, "multi_zone", user);

    expect(result.scanPolicy).toBe("multi_zone");
    expect(mockTxUpdate).not.toHaveBeenCalled();
    const updatedEmit = mockEventEmit.mock.calls.find((c) => c[0] === "event.updated");
    expect(updatedEmit).toBeUndefined();
  });

  it("allows flipping TO single on free plans (no paid-feature gate when stepping down)", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      id: "ev-1",
      organizationId: "org-1",
      scanPolicy: "multi_zone",
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(freeOrg);

    const result = await service.setScanPolicy(event.id, "single", user);
    expect(result.scanPolicy).toBe("single");
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects flipping to multi_day / multi_zone without advancedAnalytics (free + starter)", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1", scanPolicy: "single" });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(freeOrg);

    await expect(service.setScanPolicy(event.id, "multi_zone", user)).rejects.toThrow(
      /advancedAnalytics|plan|Limite/i,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("rejects callers from a different org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1", scanPolicy: "single" });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });

    await expect(service.setScanPolicy(event.id, "multi_zone", user)).rejects.toThrow(
      "Accès refusé",
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("rejects without event:update permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    await expect(service.setScanPolicy("ev-1", "multi_zone", user)).rejects.toThrow(
      "Permission manquante",
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });
});
