import { describe, it, expect, vi, beforeEach } from "vitest";
import { FeedService } from "../feed.service";
import { buildOrganizerUser, buildAuthUser, buildEvent } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockFeedPostRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findByEvent: vi.fn(),
  update: vi.fn(),
  increment: vi.fn(),
};

const mockFeedCommentRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findByPost: vi.fn(),
  update: vi.fn(),
};

const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};

vi.mock("@/repositories/feed.repository", () => ({
  feedPostRepository: new Proxy({}, {
    get: (_target, prop) => (mockFeedPostRepo as Record<string, unknown>)[prop as string],
  }),
  feedCommentRepository: new Proxy({}, {
    get: (_target, prop) => (mockFeedCommentRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy({}, {
    get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        update: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  COLLECTIONS: {
    FEED_POSTS: "feedPosts",
    FEED_COMMENTS: "feedComments",
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("FeedService", () => {
  const service = new FeedService();
  const orgId = "org-1";
  const eventId = "ev-1";
  const event = buildEvent({ id: eventId, organizationId: orgId });
  const user = buildOrganizerUser(orgId);

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
  });

  describe("createPost", () => {
    it("creates a feed post", async () => {
      const dto = { content: "Hello everyone!", mediaURLs: [], isAnnouncement: false };
      const expected = { id: "post-1", eventId, content: dto.content, authorId: user.uid };
      mockFeedPostRepo.create.mockResolvedValue(expected);

      const result = await service.createPost(eventId, dto, user);

      expect(result.id).toBe("post-1");
      expect(mockFeedPostRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Hello everyone!", eventId }),
      );
    });

    it("requires feed:create_announcement for announcements", async () => {
      const participant = buildAuthUser({ roles: ["participant"] });
      const dto = { content: "Important!", isAnnouncement: true };

      await expect(service.createPost(eventId, dto, participant)).rejects.toThrow(
        "Missing permission",
      );
    });

    it("allows participants to create regular posts", async () => {
      const participant = buildAuthUser({ roles: ["participant"] });
      const dto = { content: "Regular post", isAnnouncement: false };
      mockFeedPostRepo.create.mockResolvedValue({ id: "post-1", content: dto.content });

      const result = await service.createPost(eventId, dto, participant);

      expect(result.id).toBe("post-1");
    });
  });

  describe("listPosts", () => {
    it("returns feed posts for the event", async () => {
      const posts = { data: [{ id: "p1" }, { id: "p2" }], meta: { total: 2, page: 1, limit: 20, totalPages: 1 } };
      mockFeedPostRepo.findByEvent.mockResolvedValue(posts);

      const result = await service.listPosts(eventId, { page: 1, limit: 20 }, user);

      expect(result.data).toHaveLength(2);
    });

    it("denies user without feed:read permission", async () => {
      const noPerms = buildAuthUser({ roles: [] as never });

      await expect(
        service.listPosts(eventId, { page: 1, limit: 20 }, noPerms),
      ).rejects.toThrow("Missing permission");
    });
  });

  describe("toggleLike", () => {
    it("likes a post when not already liked", async () => {
      mockFeedPostRepo.findByIdOrThrow.mockResolvedValue({
        id: "post-1", eventId, likedByIds: [],
      });

      const result = await service.toggleLike(eventId, "post-1", user);

      expect(result.liked).toBe(true);
    });

    it("unlikes a post when already liked", async () => {
      mockFeedPostRepo.findByIdOrThrow.mockResolvedValue({
        id: "post-1", eventId, likedByIds: [user.uid],
      });

      const result = await service.toggleLike(eventId, "post-1", user);

      expect(result.liked).toBe(false);
    });

    it("rejects if post belongs to different event", async () => {
      mockFeedPostRepo.findByIdOrThrow.mockResolvedValue({
        id: "post-1", eventId: "other-event", likedByIds: [],
      });

      await expect(
        service.toggleLike(eventId, "post-1", user),
      ).rejects.toThrow("does not belong");
    });
  });

  describe("deletePost", () => {
    it("allows author to delete own post", async () => {
      mockFeedPostRepo.findByIdOrThrow.mockResolvedValue({
        id: "post-1", eventId, authorId: user.uid,
      });

      await service.deletePost(eventId, "post-1", user);

      expect(mockFeedPostRepo.update).toHaveBeenCalledWith(
        "post-1",
        expect.objectContaining({ deletedAt: expect.any(String) }),
      );
    });

    it("allows moderator to delete others' posts", async () => {
      mockFeedPostRepo.findByIdOrThrow.mockResolvedValue({
        id: "post-1", eventId, authorId: "other-user",
      });

      await service.deletePost(eventId, "post-1", user);

      expect(mockFeedPostRepo.update).toHaveBeenCalled();
    });

    it("denies non-author non-moderator", async () => {
      const participant = buildAuthUser({ roles: ["participant"] });
      mockFeedPostRepo.findByIdOrThrow.mockResolvedValue({
        id: "post-1", eventId, authorId: "someone-else",
      });

      await expect(
        service.deletePost(eventId, "post-1", participant),
      ).rejects.toThrow("Missing permission");
    });
  });

  describe("addComment", () => {
    it("adds a comment to a post", async () => {
      mockFeedPostRepo.findByIdOrThrow.mockResolvedValue({ id: "post-1", eventId });
      mockFeedCommentRepo.create.mockResolvedValue({ id: "cmt-1", content: "Nice!" });

      const result = await service.addComment(eventId, "post-1", { content: "Nice!" }, user);

      expect(result.id).toBe("cmt-1");
      expect(mockFeedPostRepo.increment).toHaveBeenCalledWith("post-1", "commentCount", 1);
    });
  });

  describe("togglePin", () => {
    it("pins an unpinned post", async () => {
      mockFeedPostRepo.findByIdOrThrow.mockResolvedValue({
        id: "post-1", eventId, isPinned: false,
      });

      const result = await service.togglePin(eventId, "post-1", user);

      expect(result.pinned).toBe(true);
      expect(mockFeedPostRepo.update).toHaveBeenCalledWith("post-1", { isPinned: true });
    });

    it("denies pin for non-moderator", async () => {
      const participant = buildAuthUser({ roles: ["participant"] });

      await expect(
        service.togglePin(eventId, "post-1", participant),
      ).rejects.toThrow("Missing permission");
    });
  });
});
