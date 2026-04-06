import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventService } from "../event.service";
import { buildAuthUser, buildOrganizerUser, buildSuperAdmin, buildEvent, buildOrganization } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

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

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy({}, {
    get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy({}, {
    get: (_target, prop) => (mockOrgRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Mock db for transactional ticket type operations
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
  COLLECTIONS: { EVENTS: "events" },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new EventService();

beforeEach(() => {
  vi.clearAllMocks();
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
    const dto = { organizationId: "org-1", title: "Test" } as any;

    await expect(service.create(dto, user)).rejects.toThrow("Missing permission");
  });

  it("rejects if user does not belong to the organization", async () => {
    const user = buildOrganizerUser("org-other");
    const dto = {
      organizationId: "org-1",
      title: "Test",
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    } as any;

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);

    await expect(service.create(dto, user)).rejects.toThrow("do not belong");
  });

  it("allows super_admin to create event for any org", async () => {
    const admin = buildSuperAdmin();
    const dto = {
      organizationId: "org-1",
      title: "Admin Event",
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    } as any;

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
    } as any;

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);

    await expect(service.create(dto, user)).rejects.toThrow("End date must be after start date");
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

    await expect(service.getById(event.id)).rejects.toThrow("Authentication required");
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

    await expect(service.getById(event.id, user)).rejects.toThrow("Access denied");
  });
});

describe("EventService.update", () => {
  it("updates event and emits domain event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockEventRepo.update.mockResolvedValue(undefined);

    await service.update(event.id, { title: "Updated Title" } as any, user);

    expect(mockEventRepo.update).toHaveBeenCalledWith(
      event.id,
      expect.objectContaining({ title: "Updated Title", updatedBy: user.uid }),
    );
  });

  it("rejects update on cancelled event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "cancelled" as any });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.update(event.id, { title: "Nope" } as any, user),
    ).rejects.toThrow("Cannot update an event with status 'cancelled'");
  });

  it("rejects update on archived event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "archived" as any });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.update(event.id, { title: "Nope" } as any, user),
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
      service.update(event.id, { endDate: "2026-05-01T00:00:00Z" } as any, user),
    ).rejects.toThrow("End date must be after start date");
  });

  it("rejects if user doesn't belong to event's org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ organizationId: "org-1", status: "draft" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.update(event.id, { title: "Nope" } as any, user),
    ).rejects.toThrow("Access denied");
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

    await expect(service.publish(event.id, user)).rejects.toThrow("Only draft events can be published");
  });

  it("rejects publishing an incomplete event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      status: "draft",
      location: null as any,
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.publish(event.id, user)).rejects.toThrow("must have title, dates, and location");
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
    const event = buildEvent({ organizationId: "org-1", status: "cancelled" as any });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.cancel(event.id, user)).rejects.toThrow("already cancelled");
  });
});

describe("EventService.archive", () => {
  it("archives an event with soft delete", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "published" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockEventRepo.softDelete.mockResolvedValue(undefined);

    await service.archive(event.id, user);

    expect(mockEventRepo.softDelete).toHaveBeenCalledWith(event.id, "status", "archived");
  });

  it("requires event:delete permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const event = buildEvent();
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.archive(event.id, user)).rejects.toThrow("Missing permission");
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

    await expect(service.unpublish(event.id, user)).rejects.toThrow("Only published events can be unpublished");
  });

  it("requires event:publish permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.unpublish("ev-1", user)).rejects.toThrow("Missing permission");
  });
});

describe("EventService.addTicketType", () => {
  it("adds a ticket type to an event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft", ticketTypes: [] });
    mockTxGet.mockResolvedValue({ exists: true, id: event.id, data: () => ({ ...event, id: undefined }) });

    const result = await service.addTicketType(event.id, {
      name: "VIP",
      price: 5000,
      currency: "XOF",
      totalQuantity: 50,
      accessZoneIds: [],
      isVisible: true,
    }, user);

    expect(result.ticketTypes).toHaveLength(1);
    expect(result.ticketTypes[0].name).toBe("VIP");
    expect(result.ticketTypes[0].soldCount).toBe(0);
    expect(result.ticketTypes[0].id).toMatch(/^tt-/);
    expect(mockTxUpdate).toHaveBeenCalled();
  });

  it("rejects adding to a cancelled event", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "cancelled" as any });
    mockTxGet.mockResolvedValue({ exists: true, id: event.id, data: () => ({ ...event, id: undefined }) });

    await expect(
      service.addTicketType(event.id, { name: "VIP" } as any, user),
    ).rejects.toThrow("Cannot modify ticket types");
  });
});

describe("EventService.updateTicketType", () => {
  it("updates a ticket type successfully", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      ticketTypes: [{ id: "tt-1", name: "Standard", price: 0, currency: "XOF" as const, totalQuantity: 100, soldCount: 0, accessZoneIds: [], isVisible: true }],
    });
    mockTxGet.mockResolvedValue({ exists: true, id: event.id, data: () => ({ ...event, id: undefined }) });

    const result = await service.updateTicketType(event.id, "tt-1", { name: "VIP", price: 5000 }, user);

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
    mockTxGet.mockResolvedValue({ exists: true, id: event.id, data: () => ({ ...event, id: undefined }) });

    await expect(
      service.updateTicketType(event.id, "tt-999", { name: "Nope" }, user),
    ).rejects.toThrow("not found");
  });

  it("rejects if user doesn't belong to event's org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({
      organizationId: "org-1",
      ticketTypes: [{ id: "tt-1", name: "Standard", price: 0, currency: "XOF" as const, totalQuantity: 100, soldCount: 0, accessZoneIds: [], isVisible: true }],
    });
    mockTxGet.mockResolvedValue({ exists: true, id: event.id, data: () => ({ ...event, id: undefined }) });

    await expect(
      service.updateTicketType(event.id, "tt-1", { name: "VIP" }, user),
    ).rejects.toThrow("Access denied");
  });
});

describe("EventService.removeTicketType", () => {
  it("removes a ticket type with zero sales", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({
      organizationId: "org-1",
      ticketTypes: [{ id: "tt-1", name: "Standard", price: 0, currency: "XOF" as const, totalQuantity: 100, soldCount: 0, accessZoneIds: [], isVisible: true }],
    });
    mockTxGet.mockResolvedValue({ exists: true, id: event.id, data: () => ({ ...event, id: undefined }) });

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
      ticketTypes: [{ id: "tt-1", name: "Standard", price: 0, currency: "XOF" as const, totalQuantity: 100, soldCount: 5, accessZoneIds: [], isVisible: true }],
    });
    mockTxGet.mockResolvedValue({ exists: true, id: event.id, data: () => ({ ...event, id: undefined }) });

    await expect(
      service.removeTicketType(event.id, "tt-1", user),
    ).rejects.toThrow("existing sales");
  });

  it("rejects removing a non-existent ticket type", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", ticketTypes: [] });
    mockTxGet.mockResolvedValue({ exists: true, id: event.id, data: () => ({ ...event, id: undefined }) });

    await expect(
      service.removeTicketType(event.id, "tt-999", user),
    ).rejects.toThrow("not found");
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

  it("filters results by title when q is provided", async () => {
    const events = [
      buildEvent({ title: "Teranga Fest" }),
      buildEvent({ title: "Dakar Tech Summit" }),
    ];
    mockEventRepo.search.mockResolvedValue({
      data: events,
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });

    const result = await service.search({
      q: "teranga",
      page: 1,
      limit: 20,
      orderBy: "startDate",
      orderDir: "asc",
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe("Teranga Fest");
  });
});

describe("EventService.clone", () => {
  it("clones an event with new dates", async () => {
    const user = buildOrganizerUser("org-1");
    const source = buildEvent({
      organizationId: "org-1",
      title: "Original Event",
      ticketTypes: [
        { id: "tt-1", name: "Standard", price: 0, currency: "XOF", totalQuantity: 100, soldCount: 50, accessZoneIds: [], isVisible: true },
      ],
      accessZones: [
        { id: "zone-1", name: "VIP", color: "#FF0000", allowedTicketTypes: ["tt-1"], capacity: 20 },
      ],
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);

    const clonedEvent = buildEvent({ id: "cloned-1", title: "Original Event (copie)", organizationId: "org-1" });
    mockEventRepo.create.mockResolvedValue(clonedEvent);

    const newStart = new Date(Date.now() + 30 * 86400000).toISOString();
    const newEnd = new Date(Date.now() + 31 * 86400000).toISOString();

    const result = await service.clone(source.id, {
      newStartDate: newStart,
      newEndDate: newEnd,
    }, user);

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

    await service.clone(source.id, {
      newTitle: "Custom Clone",
      newStartDate: new Date(Date.now() + 86400000).toISOString(),
      newEndDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    }, user);

    expect(mockEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Custom Clone" }),
    );
  });

  it("rejects clone if end date is before start date", async () => {
    const user = buildOrganizerUser("org-1");
    const source = buildEvent({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);

    await expect(
      service.clone(source.id, {
        newStartDate: "2026-06-01T00:00:00.000Z",
        newEndDate: "2026-05-01T00:00:00.000Z",
      }, user),
    ).rejects.toThrow("End date must be after start date");
  });

  it("rejects clone for user without org access", async () => {
    const user = buildOrganizerUser("other-org");
    const source = buildEvent({ organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);

    await expect(
      service.clone(source.id, {
        newStartDate: new Date(Date.now() + 86400000).toISOString(),
        newEndDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      }, user),
    ).rejects.toThrow("Access denied");
  });

  it("skips ticket types and zones when options are false", async () => {
    const user = buildOrganizerUser("org-1");
    const source = buildEvent({
      organizationId: "org-1",
      ticketTypes: [{ id: "tt-1", name: "Standard", price: 0, currency: "XOF", totalQuantity: 100, soldCount: 0, accessZoneIds: [], isVisible: true }],
      accessZones: [{ id: "zone-1", name: "VIP", color: "#FF0000", allowedTicketTypes: [], capacity: null }],
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);
    mockEventRepo.create.mockResolvedValue(buildEvent());

    await service.clone(source.id, {
      newStartDate: new Date(Date.now() + 86400000).toISOString(),
      newEndDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      copyTicketTypes: false,
      copyAccessZones: false,
    }, user);

    const createCall = mockEventRepo.create.mock.calls[0][0];
    expect(createCall.ticketTypes).toHaveLength(0);
    expect(createCall.accessZones).toHaveLength(0);
  });
});
