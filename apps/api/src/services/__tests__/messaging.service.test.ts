import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessagingService } from "../messaging.service";
import { buildOrganizerUser, buildAuthUser } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockConversationRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findByUser: vi.fn(),
  findByParticipants: vi.fn(),
  update: vi.fn(),
};

const mockMessageRepo = {
  create: vi.fn(),
  findByConversation: vi.fn(),
  findMany: vi.fn(),
};

vi.mock("@/repositories/messaging.repository", () => ({
  conversationRepository: new Proxy({}, {
    get: (_target, prop) => (mockConversationRepo as Record<string, unknown>)[prop as string],
  }),
  messageRepository: new Proxy({}, {
    get: (_target, prop) => (mockMessageRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

const mockBatch = {
  update: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/config/firebase", () => ({
  db: {
    batch: vi.fn(() => mockBatch),
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({ id: "mock-doc" }),
    }),
  },
  COLLECTIONS: {
    MESSAGES: "messages",
    CONVERSATIONS: "conversations",
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("MessagingService", () => {
  const service = new MessagingService();
  const user = buildOrganizerUser("org-1", { uid: "user-1", email: "user1@test.com" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getOrCreateConversation", () => {
    it("returns existing conversation if found", async () => {
      const existing = { id: "conv-1", participantIds: ["user-1", "user-2"] };
      mockConversationRepo.findByParticipants.mockResolvedValue(existing);

      const result = await service.getOrCreateConversation(
        { participantId: "user-2" },
        user,
      );

      expect(result.id).toBe("conv-1");
      expect(mockConversationRepo.create).not.toHaveBeenCalled();
    });

    it("creates a new conversation if none exists", async () => {
      mockConversationRepo.findByParticipants.mockResolvedValue(null);
      mockConversationRepo.create.mockResolvedValue({
        id: "conv-new", participantIds: ["user-1", "user-2"],
      });

      const result = await service.getOrCreateConversation(
        { participantId: "user-2" },
        user,
      );

      expect(result.id).toBe("conv-new");
      expect(mockConversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          participantIds: ["user-1", "user-2"],
        }),
      );
    });

    it("denies user without messaging:send permission", async () => {
      const noPerms = buildAuthUser({ roles: [] as never });

      await expect(
        service.getOrCreateConversation({ participantId: "user-2" }, noPerms),
      ).rejects.toThrow("Missing permission");
    });
  });

  describe("sendMessage", () => {
    it("sends a message in a conversation", async () => {
      mockConversationRepo.findByIdOrThrow.mockResolvedValue({
        id: "conv-1",
        participantIds: ["user-1", "user-2"],
        unreadCounts: {},
      });
      mockMessageRepo.create.mockResolvedValue({
        id: "msg-1", content: "Hello!", senderId: "user-1", createdAt: new Date().toISOString(),
      });

      const result = await service.sendMessage(
        "conv-1",
        { content: "Hello!", type: "text" },
        user,
      );

      expect(result.id).toBe("msg-1");
      expect(mockConversationRepo.update).toHaveBeenCalledWith(
        "conv-1",
        expect.objectContaining({
          lastMessage: "Hello!",
          unreadCounts: { "user-2": 1 },
        }),
      );
    });

    it("rejects if user is not a participant", async () => {
      mockConversationRepo.findByIdOrThrow.mockResolvedValue({
        id: "conv-1",
        participantIds: ["other-1", "other-2"],
        unreadCounts: {},
      });

      await expect(
        service.sendMessage("conv-1", { content: "Hi" }, user),
      ).rejects.toThrow("Not a participant");
    });
  });

  describe("listMessages", () => {
    it("returns messages for participant", async () => {
      mockConversationRepo.findByIdOrThrow.mockResolvedValue({
        id: "conv-1", participantIds: ["user-1", "user-2"],
      });
      const messages = { data: [{ id: "m1" }], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } };
      mockMessageRepo.findByConversation.mockResolvedValue(messages);

      const result = await service.listMessages("conv-1", { page: 1, limit: 50 }, user);

      expect(result.data).toHaveLength(1);
    });

    it("denies non-participant", async () => {
      mockConversationRepo.findByIdOrThrow.mockResolvedValue({
        id: "conv-1", participantIds: ["other-1", "other-2"],
      });

      await expect(
        service.listMessages("conv-1", { page: 1, limit: 50 }, user),
      ).rejects.toThrow("Not a participant");
    });
  });

  describe("listConversations", () => {
    it("returns user's conversations", async () => {
      const conversations = { data: [{ id: "c1" }, { id: "c2" }], meta: { total: 2, page: 1, limit: 50, totalPages: 1 } };
      mockConversationRepo.findByUser.mockResolvedValue(conversations);

      const result = await service.listConversations({ page: 1, limit: 50 }, user);

      expect(result.data).toHaveLength(2);
    });
  });

  describe("markAsRead", () => {
    it("resets unread count for user", async () => {
      mockConversationRepo.findByIdOrThrow.mockResolvedValue({
        id: "conv-1",
        participantIds: ["user-1", "user-2"],
        unreadCounts: { "user-1": 5 },
      });
      mockMessageRepo.findMany.mockResolvedValue({ data: [], meta: { total: 0 } });

      await service.markAsRead("conv-1", user);

      expect(mockConversationRepo.update).toHaveBeenCalledWith(
        "conv-1",
        expect.objectContaining({
          unreadCounts: { "user-1": 0 },
        }),
      );
    });

    it("denies non-participant", async () => {
      mockConversationRepo.findByIdOrThrow.mockResolvedValue({
        id: "conv-1", participantIds: ["other-1", "other-2"],
      });

      await expect(service.markAsRead("conv-1", user)).rejects.toThrow("Not a participant");
    });
  });
});
