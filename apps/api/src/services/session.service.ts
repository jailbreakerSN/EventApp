import {
  type Session,
  type CreateSessionDto,
  type UpdateSessionDto,
  type SessionBookmark,
  type SessionScheduleQuery,
} from "@teranga/shared-types";
import { sessionRepository, sessionBookmarkRepository } from "@/repositories/session.repository";
import { eventRepository } from "@/repositories/event.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";
import { ValidationError } from "@/errors/app-error";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { type PaginatedResult } from "@/repositories/base.repository";

export class SessionService extends BaseService {
  // ─── Create ───────────────────────────────────────────────────────────────

  async create(eventId: string, dto: CreateSessionDto, user: AuthUser): Promise<Session> {
    this.requirePermission(user, "event:create");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    if (new Date(dto.endTime) <= new Date(dto.startTime)) {
      throw new ValidationError("L'heure de fin doit être postérieure à l'heure de début");
    }

    const session = await sessionRepository.create({
      ...dto,
      eventId,
    });

    eventBus.emit("session.created", {
      sessionId: session.id,
      eventId,
      title: session.title,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return session;
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(
    eventId: string,
    sessionId: string,
    dto: UpdateSessionDto,
    user: AuthUser,
  ): Promise<void> {
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const session = await sessionRepository.findByIdOrThrow(sessionId);
    if (session.eventId !== eventId) {
      throw new ValidationError("Cette session n'appartient pas à cet événement");
    }

    if (dto.startTime && dto.endTime) {
      if (new Date(dto.endTime) <= new Date(dto.startTime)) {
        throw new ValidationError("L'heure de fin doit être postérieure à l'heure de début");
      }
    } else if (dto.endTime && !dto.startTime) {
      if (new Date(dto.endTime) <= new Date(session.startTime)) {
        throw new ValidationError("L'heure de fin doit être postérieure à l'heure de début");
      }
    } else if (dto.startTime && !dto.endTime) {
      if (new Date(session.endTime) <= new Date(dto.startTime)) {
        throw new ValidationError("L'heure de fin doit être postérieure à l'heure de début");
      }
    }

    await sessionRepository.update(sessionId, dto);

    eventBus.emit("session.updated", {
      sessionId,
      eventId,
      changes: Object.keys(dto),
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async delete(eventId: string, sessionId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const session = await sessionRepository.findByIdOrThrow(sessionId);
    if (session.eventId !== eventId) {
      throw new ValidationError("Cette session n'appartient pas à cet événement");
    }

    // Soft-delete by removing the document (sessions don't have status)
    // Actually let's use a deletedAt pattern
    await sessionRepository.update(sessionId, { deletedAt: new Date().toISOString() } as never);

    eventBus.emit("session.deleted", {
      sessionId,
      eventId,
      title: session.title,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── List / Schedule ──────────────────────────────────────────────────────

  async listByEvent(
    eventId: string,
    query: SessionScheduleQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<Session>> {
    this.requirePermission(user, "event:read");

    // Verify event exists and check org access for non-published events
    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      this.requireOrganizationAccess(user, event.organizationId);
    }

    if (query.date) {
      return sessionRepository.findByEventAndDate(eventId, query.date, {
        page: query.page ?? 1,
        limit: query.limit ?? 50,
      });
    }

    return sessionRepository.findByEvent(eventId, {
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    });
  }

  // ─── Get Single ───────────────────────────────────────────────────────────

  async getById(eventId: string, sessionId: string, user: AuthUser): Promise<Session> {
    this.requirePermission(user, "event:read");

    const session = await sessionRepository.findByIdOrThrow(sessionId);
    if (session.eventId !== eventId) {
      throw new ValidationError("Cette session n'appartient pas à cet événement");
    }

    return session;
  }

  // ─── Bookmarks ────────────────────────────────────────────────────────────

  async bookmark(eventId: string, sessionId: string, user: AuthUser): Promise<SessionBookmark> {
    this.requirePermission(user, "event:read");

    const session = await sessionRepository.findByIdOrThrow(sessionId);
    if (session.eventId !== eventId) {
      throw new ValidationError("Cette session n'appartient pas à cet événement");
    }

    // IDOR fix: verify org access for non-published events
    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      this.requireOrganizationAccess(user, event.organizationId);
    }

    // Check if already bookmarked
    const existing = await sessionBookmarkRepository.findByUserAndSession(user.uid, sessionId);
    if (existing) return existing;

    return sessionBookmarkRepository.create({
      sessionId,
      eventId,
      userId: user.uid,
    });
  }

  async removeBookmark(eventId: string, sessionId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:read");

    const bookmark = await sessionBookmarkRepository.findByUserAndSession(user.uid, sessionId);
    if (bookmark) {
      await sessionBookmarkRepository.deleteBookmark(bookmark.id);
    }
  }

  async getUserBookmarks(eventId: string, user: AuthUser): Promise<SessionBookmark[]> {
    this.requirePermission(user, "event:read");

    // IDOR fix: verify org access for non-published events
    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      this.requireOrganizationAccess(user, event.organizationId);
    }

    return sessionBookmarkRepository.findByUserAndEvent(user.uid, eventId);
  }
}

export const sessionService = new SessionService();
