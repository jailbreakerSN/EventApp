import { type FeedPost, type FeedComment } from "@teranga/shared-types";
import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "./base.repository";

class FeedPostRepository extends BaseRepository<FeedPost> {
  constructor() {
    super(COLLECTIONS.FEED_POSTS, "FeedPost");
  }

  async findByEvent(
    eventId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<FeedPost>> {
    return this.findMany(
      [
        { field: "eventId", op: "==", value: eventId },
        { field: "deletedAt", op: "==", value: null },
      ],
      { ...pagination, orderBy: "createdAt", orderDir: "desc" },
    );
  }
}

class FeedCommentRepository extends BaseRepository<FeedComment> {
  constructor() {
    super(COLLECTIONS.FEED_COMMENTS, "FeedComment");
  }

  async findByPost(
    postId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<FeedComment>> {
    return this.findMany(
      [
        { field: "postId", op: "==", value: postId },
        { field: "deletedAt", op: "==", value: null },
      ],
      { ...pagination, orderBy: "createdAt", orderDir: "asc" },
    );
  }
}

export const feedPostRepository = new FeedPostRepository();
export const feedCommentRepository = new FeedCommentRepository();
