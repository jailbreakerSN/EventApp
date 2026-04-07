import {
  type FeedPost,
  type FeedComment,
  type CreateFeedPostDto,
  type CreateFeedCommentDto,
  type FeedQuery,
} from "@teranga/shared-types";
import { feedPostRepository, feedCommentRepository } from "@/repositories/feed.repository";
import { eventRepository } from "@/repositories/event.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";
import { ForbiddenError } from "@/errors/app-error";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { type PaginatedResult } from "@/repositories/base.repository";
import { db, COLLECTIONS } from "@/config/firebase";
import { FieldValue } from "firebase-admin/firestore";

export class FeedService extends BaseService {
  // ─── Create Post ──────────────────────────────────────────────────────────

  async createPost(eventId: string, dto: CreateFeedPostDto, user: AuthUser): Promise<FeedPost> {
    if (dto.isAnnouncement) {
      this.requirePermission(user, "feed:create_announcement");
    } else {
      this.requirePermission(user, "feed:create_post");
    }

    const event = await eventRepository.findByIdOrThrow(eventId);

    // Announcements require org access
    if (dto.isAnnouncement) {
      this.requireOrganizationAccess(user, event.organizationId);
    }

    const post = await feedPostRepository.create({
      eventId,
      authorId: user.uid,
      authorName: user.email?.split("@")[0] ?? "User",
      authorPhotoURL: null,
      authorRole: user.roles[0] ?? "participant",
      content: dto.content,
      mediaURLs: dto.mediaURLs ?? [],
      likeCount: 0,
      commentCount: 0,
      likedByIds: [],
      isPinned: false,
      isAnnouncement: dto.isAnnouncement ?? false,
      deletedAt: null,
    });

    eventBus.emit("feed_post.created", {
      postId: post.id,
      eventId,
      authorId: user.uid,
      isAnnouncement: post.isAnnouncement,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return post;
  }

  // ─── List Posts ───────────────────────────────────────────────────────────

  async listPosts(
    eventId: string,
    query: FeedQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<FeedPost>> {
    this.requirePermission(user, "feed:read");
    await eventRepository.findByIdOrThrow(eventId);

    return feedPostRepository.findByEvent(eventId, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  // ─── Like / Unlike ────────────────────────────────────────────────────────

  async toggleLike(eventId: string, postId: string, user: AuthUser): Promise<{ liked: boolean }> {
    this.requirePermission(user, "feed:read");

    const post = await feedPostRepository.findByIdOrThrow(postId);
    if (post.eventId !== eventId) {
      throw new ForbiddenError("Cette publication n'appartient pas à cet événement");
    }

    // IDOR fix: verify org access for non-public events
    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      this.requireOrganizationAccess(user, event.organizationId);
    }

    // Use transaction to prevent race conditions on read-then-write
    const postRef = db.collection(COLLECTIONS.FEED_POSTS).doc(postId);
    return db.runTransaction(async (tx) => {
      const postSnap = await tx.get(postRef);
      const postData = postSnap.data();
      const likedByIds: string[] = postData?.likedByIds ?? [];
      const isLiked = likedByIds.includes(user.uid);

      if (isLiked) {
        tx.update(postRef, {
          likedByIds: FieldValue.arrayRemove(user.uid),
          likeCount: FieldValue.increment(-1),
          updatedAt: new Date().toISOString(),
        });
        return { liked: false };
      } else {
        tx.update(postRef, {
          likedByIds: FieldValue.arrayUnion(user.uid),
          likeCount: FieldValue.increment(1),
          updatedAt: new Date().toISOString(),
        });
        return { liked: true };
      }
    });
  }

  // ─── Pin / Unpin ──────────────────────────────────────────────────────────

  async togglePin(eventId: string, postId: string, user: AuthUser): Promise<{ pinned: boolean }> {
    this.requirePermission(user, "feed:moderate");

    const post = await feedPostRepository.findByIdOrThrow(postId);
    if (post.eventId !== eventId) {
      throw new ForbiddenError("Cette publication n'appartient pas à cet événement");
    }

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const newPinned = !post.isPinned;
    await feedPostRepository.update(postId, { isPinned: newPinned });

    eventBus.emit("feed_post.pinned", {
      postId,
      eventId,
      pinned: newPinned,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return { pinned: newPinned };
  }

  // ─── Delete Post (moderation) ─────────────────────────────────────────────

  async deletePost(eventId: string, postId: string, user: AuthUser): Promise<void> {
    const post = await feedPostRepository.findByIdOrThrow(postId);
    if (post.eventId !== eventId) {
      throw new ForbiddenError("Cette publication n'appartient pas à cet événement");
    }

    // Author can delete own post, or moderators
    if (post.authorId !== user.uid) {
      this.requirePermission(user, "feed:moderate");
      const event = await eventRepository.findByIdOrThrow(eventId);
      this.requireOrganizationAccess(user, event.organizationId);
    }

    await feedPostRepository.update(postId, { deletedAt: new Date().toISOString() });

    eventBus.emit("feed_post.deleted", {
      postId,
      eventId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  async addComment(
    eventId: string,
    postId: string,
    dto: CreateFeedCommentDto,
    user: AuthUser,
  ): Promise<FeedComment> {
    this.requirePermission(user, "feed:create_post");

    const post = await feedPostRepository.findByIdOrThrow(postId);
    if (post.eventId !== eventId) {
      throw new ForbiddenError("Cette publication n'appartient pas à cet événement");
    }

    // IDOR fix: verify org access for non-public events
    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      this.requireOrganizationAccess(user, event.organizationId);
    }

    // Use transaction to atomically create comment and increment count
    const postRef = db.collection(COLLECTIONS.FEED_POSTS).doc(postId);
    const commentRef = db.collection(COLLECTIONS.FEED_COMMENTS).doc();

    const now = new Date().toISOString();
    const commentData = {
      id: commentRef.id,
      postId,
      authorId: user.uid,
      authorName: user.email?.split("@")[0] ?? "User",
      content: dto.content,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.runTransaction(async (tx) => {
      tx.create(commentRef, commentData);
      tx.update(postRef, {
        commentCount: FieldValue.increment(1),
        updatedAt: now,
      });
    });

    return commentData as FeedComment;
  }

  async listComments(
    eventId: string,
    postId: string,
    query: FeedQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<FeedComment>> {
    this.requirePermission(user, "feed:read");

    const post = await feedPostRepository.findByIdOrThrow(postId);
    if (post.eventId !== eventId) {
      throw new ForbiddenError("Cette publication n'appartient pas à cet événement");
    }

    // IDOR fix: verify org access for non-public events
    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      this.requireOrganizationAccess(user, event.organizationId);
    }

    return feedCommentRepository.findByPost(postId, {
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    });
  }

  async deleteComment(
    eventId: string,
    postId: string,
    commentId: string,
    user: AuthUser,
  ): Promise<void> {
    const comment = await feedCommentRepository.findByIdOrThrow(commentId);

    // IDOR fix: verify the comment's post belongs to an event in the user's org
    const post = await feedPostRepository.findByIdOrThrow(postId);
    if (post.eventId !== eventId) {
      throw new ForbiddenError("Cette publication n'appartient pas à cet événement");
    }
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Author can delete own, or moderators
    if (comment.authorId !== user.uid) {
      this.requirePermission(user, "feed:moderate");
    }

    await feedCommentRepository.update(commentId, { deletedAt: new Date().toISOString() });
    await feedPostRepository.increment(postId, "commentCount", -1);
  }
}

export const feedService = new FeedService();
