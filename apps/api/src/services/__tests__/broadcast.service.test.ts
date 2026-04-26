import { describe, it, expect, vi, beforeEach } from "vitest";
import { BroadcastService } from "../broadcast.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildSuperAdmin,
  buildEvent,
  buildBroadcast,
  buildRegistration,
} from "@/__tests__/factories";
import { type CreateBroadcastDto } from "@teranga/shared-types";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockBroadcastRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findByEvent: vi.fn(),
  update: vi.fn(),
};

const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockRegistrationRepo = {
  findByEventCursor: vi.fn(),
};

const mockUserRepo = {
  findById: vi.fn(),
  getFcmTokens: vi.fn().mockResolvedValue([]),
};

// Plan-gate mock — broadcast.service fetches the org only when SMS
// or WhatsApp channels are requested. Configurable plan so the gate
// tests can flip to `free`.
const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

vi.mock("@/repositories/broadcast.repository", () => ({
  broadcastRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockBroadcastRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

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
      get: (_target, prop) => (mockRegistrationRepo as Record<string, unknown>)[prop as string],
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

// Mock notification service (used internally by broadcast for push/in_app)
const mockNotificationBroadcast = vi.fn().mockResolvedValue({ sent: 0 });
vi.mock("@/services/notification.service", () => ({
  notificationService: {
    broadcast: (...args: unknown[]) => mockNotificationBroadcast(...args),
  },
}));

// Mock providers
vi.mock("@/providers/mock-sms.provider", () => ({
  mockSmsProvider: {
    sendBulk: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
  },
}));

vi.mock("@/providers/mock-email.provider", () => ({
  mockEmailProvider: {
    sendBulk: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
  },
}));

// Mock Firestore for notification service internals
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ id: "doc-1", set: vi.fn().mockResolvedValue(undefined) })),
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ docs: [] }),
        })),
        get: vi.fn().mockResolvedValue({ docs: [] }),
      })),
    })),
    batch: vi.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
  },
  messaging: {
    sendEachForMulticast: vi.fn().mockResolvedValue({ successCount: 0 }),
  },
  COLLECTIONS: {
    EVENTS: "events",
    REGISTRATIONS: "registrations",
    NOTIFICATIONS: "notifications",
    BROADCASTS: "broadcasts",
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new BroadcastService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BroadcastService.sendBroadcast", () => {
  const orgId = "org-1";

  const dto: CreateBroadcastDto = {
    eventId: "ev-1",
    title: "Rappel",
    body: "N'oubliez pas l'événement demain !",
    channels: ["push"],
    recipientFilter: "all",
  };

  it("sends a broadcast and updates status to sent", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    const created = buildBroadcast({ id: "bc-1", eventId: "ev-1", status: "sending" });
    const final = buildBroadcast({ id: "bc-1", eventId: "ev-1", status: "sent" });
    const registrations = [buildRegistration({ userId: "u1", status: "confirmed" })];

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBroadcastRepo.create.mockResolvedValue(created);
    mockRegistrationRepo.findByEventCursor
      .mockResolvedValueOnce({ data: registrations, lastDoc: null })
      .mockResolvedValueOnce({ data: [], lastDoc: null });
    mockBroadcastRepo.update.mockResolvedValue(undefined);
    mockBroadcastRepo.findByIdOrThrow.mockResolvedValue(final);

    const result = await service.sendBroadcast(dto, user);

    expect(result.id).toBe("bc-1");
    expect(mockBroadcastRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "ev-1",
        title: "Rappel",
        status: "sending",
        createdBy: user.uid,
      }),
    );
    expect(mockBroadcastRepo.update).toHaveBeenCalledWith(
      "bc-1",
      expect.objectContaining({
        recipientCount: 1,
      }),
    );
  });

  it("filters recipients by checked_in status", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    const created = buildBroadcast({ id: "bc-2", status: "sending" });

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBroadcastRepo.create.mockResolvedValue(created);
    mockRegistrationRepo.findByEventCursor.mockResolvedValue({ data: [], lastDoc: null });
    mockBroadcastRepo.update.mockResolvedValue(undefined);
    mockBroadcastRepo.findByIdOrThrow.mockResolvedValue(buildBroadcast());

    await service.sendBroadcast({ ...dto, recipientFilter: "checked_in" }, user);

    expect(mockRegistrationRepo.findByEventCursor).toHaveBeenCalledWith(
      "ev-1",
      ["checked_in"],
      expect.any(Number),
      undefined,
    );
  });

  it("filters recipients by not_checked_in status", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    const created = buildBroadcast({ id: "bc-3", status: "sending" });

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBroadcastRepo.create.mockResolvedValue(created);
    mockRegistrationRepo.findByEventCursor.mockResolvedValue({ data: [], lastDoc: null });
    mockBroadcastRepo.update.mockResolvedValue(undefined);
    mockBroadcastRepo.findByIdOrThrow.mockResolvedValue(buildBroadcast());

    await service.sendBroadcast({ ...dto, recipientFilter: "not_checked_in" }, user);

    expect(mockRegistrationRepo.findByEventCursor).toHaveBeenCalledWith(
      "ev-1",
      ["confirmed"],
      expect.any(Number),
      undefined,
    );
  });

  it("rejects participant without broadcast:send permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.sendBroadcast(dto, user)).rejects.toThrow(
      "Permission manquante : broadcast:send",
    );
  });

  it("rejects user without org access", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.sendBroadcast(dto, user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });

  it("allows super_admin to broadcast for any org", async () => {
    const admin = buildSuperAdmin();
    const event = buildEvent({ id: "ev-1", organizationId: "any-org" });
    const created = buildBroadcast({ id: "bc-admin", status: "sending" });

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBroadcastRepo.create.mockResolvedValue(created);
    mockRegistrationRepo.findByEventCursor.mockResolvedValue({ data: [], lastDoc: null });
    mockBroadcastRepo.update.mockResolvedValue(undefined);
    mockBroadcastRepo.findByIdOrThrow.mockResolvedValue(buildBroadcast({ id: "bc-admin" }));

    const result = await service.sendBroadcast(dto, admin);

    expect(result.id).toBe("bc-admin");
  });

  it("emits broadcast.sent domain event after completion", async () => {
    const { eventBus } = await import("@/events/event-bus");
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBroadcastRepo.create.mockResolvedValue(buildBroadcast({ id: "bc-ev" }));
    mockRegistrationRepo.findByEventCursor.mockResolvedValue({ data: [], lastDoc: null });
    mockBroadcastRepo.update.mockResolvedValue(undefined);
    mockBroadcastRepo.findByIdOrThrow.mockResolvedValue(buildBroadcast({ id: "bc-ev" }));

    await service.sendBroadcast(dto, user);

    expect(eventBus.emit).toHaveBeenCalledWith(
      "broadcast.sent",
      expect.objectContaining({
        broadcastId: "bc-ev",
        eventId: "ev-1",
        organizationId: orgId,
      }),
    );
  });
});

describe("BroadcastService.listBroadcasts", () => {
  it("returns broadcasts for an event with org access", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1" });
    const broadcasts = [buildBroadcast(), buildBroadcast()];

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBroadcastRepo.findByEvent.mockResolvedValue({
      data: broadcasts,
      meta: { total: 2, page: 1, limit: 20, totalPages: 1 },
    });

    const result = await service.listBroadcasts("ev-1", {}, { page: 1, limit: 20 }, user);

    expect(result.data).toHaveLength(2);
    expect(mockBroadcastRepo.findByEvent).toHaveBeenCalledWith("ev-1", {}, { page: 1, limit: 20 });
  });

  it("rejects participant without broadcast:read permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.listBroadcasts("ev-1", {}, { page: 1, limit: 20 }, user)).rejects.toThrow(
      "Permission manquante : broadcast:read",
    );
  });

  it("rejects user without org access", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.listBroadcasts("ev-1", {}, { page: 1, limit: 20 }, user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });
});

// ─── Plan-feature gates on premium channels (SMS + WhatsApp) ──────────────

describe("BroadcastService.sendBroadcast — plan-feature gates", () => {
  const orgId = "org-1";

  it("throws PlanLimitError when SMS is requested on a free-plan org", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockOrgRepo.findByIdOrThrow.mockResolvedValue({ id: orgId, plan: "free" });

    await expect(
      service.sendBroadcast(
        {
          eventId: "ev-1",
          title: "Rappel",
          body: "Bonjour",
          channels: ["sms"],
          recipientFilter: "all",
        },
        user,
      ),
    ).rejects.toThrow(/plan/i);
    expect(mockBroadcastRepo.create).not.toHaveBeenCalled();
  });

  it("throws PlanLimitError when WhatsApp is requested on a free-plan org", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockOrgRepo.findByIdOrThrow.mockResolvedValue({ id: orgId, plan: "free" });

    await expect(
      service.sendBroadcast(
        {
          eventId: "ev-1",
          title: "Rappel",
          body: "Bonjour",
          channels: ["whatsapp"],
          recipientFilter: "all",
        },
        user,
      ),
    ).rejects.toThrow(/plan/i);
    expect(mockBroadcastRepo.create).not.toHaveBeenCalled();
  });

  it("does NOT fetch the org when only push / in_app / email channels are used", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    // The broadcast.create + downstream calls are mocked to no-op so
    // the test focuses on the plan-fetch contract: the org repo
    // should NEVER be hit when only non-gated channels are used.
    mockBroadcastRepo.create.mockResolvedValue(
      buildBroadcast({ id: "bc-1", eventId: "ev-1", status: "sending" }),
    );
    mockRegistrationRepo.findByEventCursor.mockResolvedValue({ data: [], nextCursor: null });
    mockBroadcastRepo.update.mockResolvedValue(undefined);
    mockBroadcastRepo.findByIdOrThrow.mockResolvedValue(
      buildBroadcast({ id: "bc-1", eventId: "ev-1", status: "sent" }),
    );

    await service.sendBroadcast(
      {
        eventId: "ev-1",
        title: "Rappel",
        body: "Bonjour",
        channels: ["push", "email", "in_app"],
        recipientFilter: "all",
      },
      user,
    );
    expect(mockOrgRepo.findByIdOrThrow).not.toHaveBeenCalled();
  });
});
