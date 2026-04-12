import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationService } from "../notification.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildSuperAdmin,
  buildEvent,
  buildRegistration,
} from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockRegistrationRepo = {
  findByEventCursor: vi.fn(),
};

const mockUserRepo = {
  getFcmTokens: vi.fn().mockResolvedValue([]),
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

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Mock Firestore
const mockDocSet = vi.fn().mockResolvedValue(undefined);
const mockDocGet = vi.fn();
const mockDocUpdate = vi.fn().mockResolvedValue(undefined);
const mockDocRef = { id: "notif-1", set: mockDocSet, get: mockDocGet, update: mockDocUpdate };
const mockWhereGet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockBatchSet = vi.fn();
const mockCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) });

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => mockDocRef),
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          count: vi.fn(() => ({ get: mockCountGet })),
          offset: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ docs: [] }),
            })),
          })),
        })),
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            count: vi.fn(() => ({ get: mockCountGet })),
            offset: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ docs: [] }),
              })),
            })),
          })),
          get: mockWhereGet,
        })),
        limit: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ docs: [] }),
        })),
        count: vi.fn(() => ({ get: mockCountGet })),
        get: mockWhereGet,
      })),
    })),
    batch: vi.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
  },
  messaging: {
    sendEachForMulticast: vi.fn().mockResolvedValue({ successCount: 1 }),
  },
  COLLECTIONS: {
    NOTIFICATIONS: "notifications",
    EVENTS: "events",
    REGISTRATIONS: "registrations",
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new NotificationService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotificationService.send", () => {
  it("creates an in-app notification and returns it", async () => {
    const result = await service.send({
      userId: "user-1",
      type: "event_updated",
      title: "Mise à jour",
      body: "L'événement a été modifié",
    });

    expect(result.userId).toBe("user-1");
    expect(result.type).toBe("event_updated");
    expect(result.isRead).toBe(false);
    expect(result.id).toBe("notif-1");
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "event_updated",
        title: "Mise à jour",
        body: "L'événement a été modifié",
        isRead: false,
        readAt: null,
      }),
    );
  });

  it("includes optional data and imageURL", async () => {
    await service.send({
      userId: "user-1",
      type: "registration_confirmed",
      title: "Confirmé",
      body: "Inscription confirmée",
      data: { eventId: "ev-1" },
      imageURL: "https://example.com/img.png",
    });

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { eventId: "ev-1" },
        imageURL: "https://example.com/img.png",
      }),
    );
  });
});

describe("NotificationService.broadcast", () => {
  it("creates notifications for confirmed participants and returns count", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1" });
    const registrations = [
      buildRegistration({ userId: "u1", status: "confirmed" }),
      buildRegistration({ userId: "u2", status: "confirmed" }),
    ];

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockRegistrationRepo.findByEventCursor
      .mockResolvedValueOnce({ data: registrations, lastDoc: null })
      .mockResolvedValueOnce({ data: [], lastDoc: null });

    const result = await service.broadcast(
      {
        eventId: "ev-1",
        type: "broadcast",
        title: "Annonce",
        body: "Message important",
      },
      user,
    );

    expect(result.sent).toBe(2);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it("rejects participant without notification:send permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(
      service.broadcast({ eventId: "ev-1", type: "broadcast", title: "Test", body: "Test" }, user),
    ).rejects.toThrow("Permission manquante : notification:send");
  });

  it("rejects user without org access", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.broadcast({ eventId: "ev-1", type: "broadcast", title: "Test", body: "Test" }, user),
    ).rejects.toThrow("Accès refusé aux ressources de cette organisation");
  });

  it("allows super_admin to broadcast for any org", async () => {
    const admin = buildSuperAdmin();
    const event = buildEvent({ id: "ev-1", organizationId: "any-org" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockRegistrationRepo.findByEventCursor.mockResolvedValueOnce({ data: [], lastDoc: null });

    const result = await service.broadcast(
      { eventId: "ev-1", type: "broadcast", title: "Admin", body: "Broadcast" },
      admin,
    );

    expect(result.sent).toBe(0);
  });
});

describe("NotificationService.markAsRead", () => {
  it("marks a notification as read for the owner", async () => {
    const user = buildAuthUser({ uid: "user-1" });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ userId: "user-1", isRead: false }),
    });

    await service.markAsRead("notif-1", user);

    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ isRead: true }));
  });

  it("rejects marking another user's notification as read", async () => {
    const user = buildAuthUser({ uid: "user-1" });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ userId: "user-other", isRead: false }),
    });

    await expect(service.markAsRead("notif-1", user)).rejects.toThrow(
      "Impossible de marquer les notifications d'un autre utilisateur",
    );
  });

  it("throws NotFoundError when notification does not exist", async () => {
    const user = buildAuthUser({ uid: "user-1" });
    mockDocGet.mockResolvedValue({ exists: false });

    await expect(service.markAsRead("notif-missing", user)).rejects.toThrow("Notification");
  });
});

describe("NotificationService.markAllAsRead", () => {
  it("batch-updates all unread notifications for the user", async () => {
    const user = buildAuthUser({ uid: "user-1" });
    const mockRef1 = { id: "n1" };
    const mockRef2 = { id: "n2" };
    mockWhereGet.mockResolvedValue({
      empty: false,
      docs: [{ ref: mockRef1 }, { ref: mockRef2 }],
    });

    await service.markAllAsRead(user);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it("does nothing when there are no unread notifications", async () => {
    const user = buildAuthUser({ uid: "user-1" });
    mockWhereGet.mockResolvedValue({ empty: true, docs: [] });

    await service.markAllAsRead(user);

    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});
