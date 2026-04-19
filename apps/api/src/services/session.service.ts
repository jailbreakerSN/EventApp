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
import { ValidationError, ForbiddenError } from "@/errors/app-error";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { type PaginatedResult } from "@/repositories/base.repository";
import { db, COLLECTIONS } from "@/config/firebase";

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

    await sessionRepository.update(sessionId, { deletedAt: new Date().toISOString() });

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
    user: AuthUser | undefined,
  ): Promise<PaginatedResult<Session>> {
    // Published agendas are PUBLIC. The participant-facing marketing site
    // renders /events/:slug via SSR without a user token, so blocking
    // anonymous callers would make the programme section disappear. The
    // draft gate below still protects unpublished events.
    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      if (!user)
        throw new ForbiddenError("Authentification requise pour voir l'agenda de cet événement");
      this.requirePermission(user, "event:read");
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

  async getById(eventId: string, sessionId: string, user: AuthUser | undefined): Promise<Session> {
    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      if (!user) throw new ForbiddenError("Authentification requise pour voir cette session");
      this.requirePermission(user, "event:read");
      this.requireOrganizationAccess(user, event.organizationId);
    }

    const session = await sessionRepository.findByIdOrThrow(sessionId);
    if (session.eventId !== eventId) {
      throw new ValidationError("Cette session n'appartient pas à cet événement");
    }

    return session;
  }

  // ─── Bookmarks ────────────────────────────────────────────────────────────

  async bookmark(eventId: string, sessionId: string, user: AuthUser): Promise<SessionBookmark> {
    // Bookmarks are per-user. Any authenticated participant can create a
    // bookmark on a session they can see. Draft/unpublished events are still
    // gated via org access below so bookmarks can't be a read-oracle for
    // hidden sessions.
    const session = await sessionRepository.findByIdOrThrow(sessionId);
    if (session.eventId !== eventId) {
      throw new ValidationError("Cette session n'appartient pas à cet événement");
    }

    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      this.requireOrganizationAccess(user, event.organizationId);
    }

    // Use deterministic ID to prevent duplicates from race conditions
    const bookmarkId = `${user.uid}_${sessionId}`;
    const bookmarkRef = db.collection(COLLECTIONS.SESSION_BOOKMARKS).doc(bookmarkId);

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(bookmarkRef);
      if (snap.exists) return { id: bookmarkId, ...snap.data() } as SessionBookmark;

      const now = new Date().toISOString();
      const bookmarkData: SessionBookmark = {
        id: bookmarkId,
        sessionId,
        eventId,
        userId: user.uid,
        createdAt: now,
      };
      tx.set(bookmarkRef, bookmarkData);
      return bookmarkData;
    });
  }

  async removeBookmark(eventId: string, sessionId: string, user: AuthUser): Promise<void> {
    // No permission check: a user can always remove their own bookmark.
    // The repository query is scoped by `user.uid` so cross-user removal
    // is impossible.
    //
    // We DO verify that the bookmark's recorded eventId matches the eventId
    // in the URL — otherwise a caller could pass the wrong event in the
    // path and still remove the bookmark. Not a security hole (they own
    // the bookmark either way), but accepting mismatched parameters is a
    // footgun that hides client bugs.
    const bookmark = await sessionBookmarkRepository.findByUserAndSession(user.uid, sessionId);
    if (!bookmark) return;
    if (bookmark.eventId !== eventId) {
      throw new ValidationError("Ce favori n'appartient pas à cet événement");
    }
    await sessionBookmarkRepository.deleteBookmark(bookmark.id);
  }

  async getUserBookmarks(eventId: string, user: AuthUser): Promise<SessionBookmark[]> {
    // A user can always read their own bookmarks. For unpublished events
    // we still require org access so the bookmark list can't be used to
    // enumerate sessions on a draft agenda.
    const event = await eventRepository.findByIdOrThrow(eventId);
    if (event.status !== "published") {
      this.requireOrganizationAccess(user, event.organizationId);
    }

    return sessionBookmarkRepository.findByUserAndEvent(user.uid, eventId);
  }
}

export const sessionService = new SessionService();
