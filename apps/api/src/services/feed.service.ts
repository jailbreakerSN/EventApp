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

    const isLiked = post.likedByIds.includes(user.uid);
    const postRef = db.collection(COLLECTIONS.FEED_POSTS).doc(postId);

    if (isLiked) {
      await postRef.update({
        likedByIds: FieldValue.arrayRemove(user.uid),
        likeCount: FieldValue.increment(-1),
        updatedAt: new Date().toISOString(),
      });
      return { liked: false };
    } else {
      await postRef.update({
        likedByIds: FieldValue.arrayUnion(user.uid),
        likeCount: FieldValue.increment(1),
        updatedAt: new Date().toISOString(),
      });
      return { liked: true };
    }
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

    const comment = await feedCommentRepository.create({
      postId,
      authorId: user.uid,
      authorName: user.email?.split("@")[0] ?? "User",
      content: dto.content,
      deletedAt: null,
    });

    // Increment comment count
    await feedPostRepository.increment(postId, "commentCount", 1);

    return comment;
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

    // Author can delete own, or moderators
    if (comment.authorId !== user.uid) {
      this.requirePermission(user, "feed:moderate");
      const event = await eventRepository.findByIdOrThrow(eventId);
      this.requireOrganizationAccess(user, event.organizationId);
    }

    await feedCommentRepository.update(commentId, { deletedAt: new Date().toISOString() });
    await feedPostRepository.increment(postId, "commentCount", -1);
  }
}

export const feedService = new FeedService();
