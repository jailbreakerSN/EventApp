import { type Session, type SessionBookmark } from "@teranga/shared-types";
import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "./base.repository";

class SessionRepository extends BaseRepository<Session> {
  constructor() {
    super(COLLECTIONS.SESSIONS, "Session");
  }

  async findByEvent(
    eventId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Session>> {
    return this.findMany([{ field: "eventId", op: "==", value: eventId }], {
      ...pagination,
      orderBy: pagination?.orderBy ?? "startTime",
      orderDir: pagination?.orderDir ?? "asc",
    });
  }

  async findByEventAndDate(
    eventId: string,
    date: string, // YYYY-MM-DD
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Session>> {
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    return this.findMany(
      [
        { field: "eventId", op: "==", value: eventId },
        { field: "startTime", op: ">=", value: dayStart },
        { field: "startTime", op: "<=", value: dayEnd },
      ],
      { ...pagination, orderBy: "startTime", orderDir: "asc" },
    );
  }
}

// ─── Bookmark Repository ────────────────────────────────────────────────────

class SessionBookmarkRepository extends BaseRepository<SessionBookmark> {
  constructor() {
    super(COLLECTIONS.SESSION_BOOKMARKS, "SessionBookmark");
  }

  async findByUserAndEvent(userId: string, eventId: string): Promise<SessionBookmark[]> {
    const result = await this.findMany(
      [
        { field: "userId", op: "==", value: userId },
        { field: "eventId", op: "==", value: eventId },
      ],
      { page: 1, limit: 500, orderBy: "createdAt", orderDir: "asc" },
    );
    return result.data;
  }

  async findByUserAndSession(userId: string, sessionId: string): Promise<SessionBookmark | null> {
    return this.findOne([
      { field: "userId", op: "==", value: userId },
      { field: "sessionId", op: "==", value: sessionId },
    ]);
  }

  async deleteBookmark(id: string): Promise<void> {
    await this.ref.doc(id).delete();
  }
}

export const sessionRepository = new SessionRepository();
export const sessionBookmarkRepository = new SessionBookmarkRepository();
