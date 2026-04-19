import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionService } from "../session.service";
import { buildOrganizerUser, buildAuthUser, buildEvent } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockSessionRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findByEvent: vi.fn(),
  findByEventAndDate: vi.fn(),
  update: vi.fn(),
};

const mockBookmarkRepo = {
  create: vi.fn(),
  findByUserAndSession: vi.fn(),
  findByUserAndEvent: vi.fn(),
  deleteBookmark: vi.fn(),
};

const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};

vi.mock("@/repositories/session.repository", () => ({
  sessionRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockSessionRepo as Record<string, unknown>)[prop as string],
    },
  ),
  sessionBookmarkRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockBookmarkRepo as Record<string, unknown>)[prop as string],
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

const { mockTxGet, mockTxSet, mockRunTransaction } = vi.hoisted(() => {
  const mockTxGet = vi.fn();
  const mockTxSet = vi.fn();
  const mockRunTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ get: mockTxGet, set: mockTxSet });
  });
  return { mockTxGet, mockTxSet, mockRunTransaction };
});

vi.mock("@/config/firebase", () => ({
  db: {
    collection: () => ({
      doc: (id?: string) => ({ id: id ?? "mock-doc-id" }),
    }),
    runTransaction: (...args: unknown[]) => mockRunTransaction(...(args as [never])),
  },
  COLLECTIONS: {
    SESSIONS: "sessions",
    SESSION_BOOKMARKS: "sessionBookmarks",
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SessionService", () => {
  const service = new SessionService();
  const orgId = "org-1";
  const eventId = "ev-1";
  const event = buildEvent({ id: eventId, organizationId: orgId });
  const user = buildOrganizerUser(orgId);

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockTxGet.mockReset();
    mockTxSet.mockReset();
    mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ get: mockTxGet, set: mockTxSet });
    });
  });

  describe("create", () => {
    it("creates a session with valid data", async () => {
      const dto = {
        eventId,
        title: "Keynote",
        startTime: "2026-06-01T09:00:00.000Z",
        endTime: "2026-06-01T10:00:00.000Z",
        speakerIds: [],
        tags: [],
        isBookmarkable: true,
      };
      const expected = { id: "sess-1", ...dto, createdAt: "now", updatedAt: "now" };
      mockSessionRepo.create.mockResolvedValue(expected);

      const result = await service.create(eventId, dto, user);

      expect(result.id).toBe("sess-1");
      expect(mockSessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Keynote", eventId }),
      );
    });

    it("rejects if end time is before start time", async () => {
      const dto = {
        eventId,
        title: "Bad Session",
        startTime: "2026-06-01T10:00:00.000Z",
        endTime: "2026-06-01T09:00:00.000Z",
        speakerIds: [],
        tags: [],
        isBookmarkable: true,
      };

      await expect(service.create(eventId, dto, user)).rejects.toThrow("heure de fin");
    });

    it("rejects user without event:create permission", async () => {
      const participant = buildAuthUser({ roles: ["participant"] });
      const dto = {
        eventId,
        title: "Test",
        startTime: "2026-06-01T09:00:00.000Z",
        endTime: "2026-06-01T10:00:00.000Z",
        speakerIds: [],
        tags: [],
        isBookmarkable: true,
      };

      await expect(service.create(eventId, dto, participant)).rejects.toThrow(
        "Permission manquante",
      );
    });

    it("rejects user from different org", async () => {
      const otherUser = buildOrganizerUser("other-org");
      const dto = {
        eventId,
        title: "Test",
        startTime: "2026-06-01T09:00:00.000Z",
        endTime: "2026-06-01T10:00:00.000Z",
        speakerIds: [],
        tags: [],
        isBookmarkable: true,
      };

      await expect(service.create(eventId, dto, otherUser)).rejects.toThrow("Accès refusé");
    });
  });

  describe("update", () => {
    it("updates a session", async () => {
      const session = {
        id: "sess-1",
        eventId,
        title: "Old",
        startTime: "2026-06-01T09:00:00.000Z",
        endTime: "2026-06-01T10:00:00.000Z",
      };
      mockSessionRepo.findByIdOrThrow.mockResolvedValue(session);

      await service.update(eventId, "sess-1", { title: "New Title" }, user);

      expect(mockSessionRepo.update).toHaveBeenCalledWith("sess-1", { title: "New Title" });
    });

    it("rejects if session does not belong to event", async () => {
      mockSessionRepo.findByIdOrThrow.mockResolvedValue({ id: "sess-1", eventId: "other-event" });

      await expect(service.update(eventId, "sess-1", { title: "New" }, user)).rejects.toThrow(
        "appartient pas",
      );
    });
  });

  describe("delete", () => {
    it("soft-deletes a session", async () => {
      mockSessionRepo.findByIdOrThrow.mockResolvedValue({ id: "sess-1", eventId, title: "Talk" });

      await service.delete(eventId, "sess-1", user);

      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        "sess-1",
        expect.objectContaining({ deletedAt: expect.any(String) }),
      );
    });
  });

  describe("listByEvent", () => {
    it("returns sessions for the event", async () => {
      const sessions = {
        data: [{ id: "s1" }, { id: "s2" }],
        meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
      };
      mockSessionRepo.findByEvent.mockResolvedValue(sessions);

      const result = await service.listByEvent(eventId, { page: 1, limit: 50 }, user);

      expect(result.data).toHaveLength(2);
    });

    it("filters by date when provided", async () => {
      const sessions = { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } };
      mockSessionRepo.findByEventAndDate.mockResolvedValue(sessions);

      await service.listByEvent(eventId, { date: "2026-06-01", page: 1, limit: 50 }, user);

      expect(mockSessionRepo.findByEventAndDate).toHaveBeenCalledWith(
        eventId,
        "2026-06-01",
        expect.any(Object),
      );
    });

    it("allows a participant to read sessions on a published event", async () => {
      const participant = buildAuthUser({ roles: ["participant"] });
      const publishedEvent = buildEvent({
        id: eventId,
        organizationId: orgId,
        status: "published",
      });
      mockEventRepo.findByIdOrThrow.mockResolvedValue(publishedEvent);
      mockSessionRepo.findByEvent.mockResolvedValue({
        data: [{ id: "s1" }],
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      });

      const result = await service.listByEvent(eventId, { page: 1, limit: 50 }, participant);

      expect(result.data).toHaveLength(1);
    });

    it("rejects a participant from reading sessions on a draft event", async () => {
      const participant = buildAuthUser({ roles: ["participant"] });
      const draftEvent = buildEvent({
        id: eventId,
        organizationId: orgId,
        status: "draft",
      });
      mockEventRepo.findByIdOrThrow.mockResolvedValue(draftEvent);

      await expect(
        service.listByEvent(eventId, { page: 1, limit: 50 }, participant),
      ).rejects.toThrow("Permission manquante");
    });
  });

  describe("bookmark", () => {
    it("bookmarks a session via transaction", async () => {
      mockSessionRepo.findByIdOrThrow.mockResolvedValue({ id: "sess-1", eventId });
      mockTxGet.mockResolvedValue({ exists: false });

      const result = await service.bookmark(eventId, "sess-1", user);

      expect(mockRunTransaction).toHaveBeenCalled();
      expect(mockTxSet).toHaveBeenCalled();
      expect(result.sessionId).toBe("sess-1");
      expect(result.userId).toBe(user.uid);
    });

    it("returns existing bookmark if already bookmarked", async () => {
      mockSessionRepo.findByIdOrThrow.mockResolvedValue({ id: "sess-1", eventId });
      mockTxGet.mockResolvedValue({
        exists: true,
        data: () => ({ id: `${user.uid}_sess-1`, sessionId: "sess-1", userId: user.uid, eventId }),
      });

      const result = await service.bookmark(eventId, "sess-1", user);

      expect(result.sessionId).toBe("sess-1");
      expect(mockTxSet).not.toHaveBeenCalled();
    });
  });

  describe("removeBookmark", () => {
    it("removes a bookmark", async () => {
      mockBookmarkRepo.findByUserAndSession.mockResolvedValue({ id: "bm-1", eventId });

      await service.removeBookmark(eventId, "sess-1", user);

      expect(mockBookmarkRepo.deleteBookmark).toHaveBeenCalledWith("bm-1");
    });

    it("rejects when the bookmark belongs to a different event", async () => {
      mockBookmarkRepo.findByUserAndSession.mockResolvedValue({
        id: "bm-1",
        eventId: "other-event",
      });

      await expect(service.removeBookmark(eventId, "sess-1", user)).rejects.toThrow(
        /n'appartient pas/,
      );
      expect(mockBookmarkRepo.deleteBookmark).not.toHaveBeenCalled();
    });

    it("silently no-ops when the user has no bookmark for the session", async () => {
      mockBookmarkRepo.findByUserAndSession.mockResolvedValue(null);

      await service.removeBookmark(eventId, "sess-1", user);

      expect(mockBookmarkRepo.deleteBookmark).not.toHaveBeenCalled();
    });
  });
});
