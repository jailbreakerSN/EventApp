import crypto from "node:crypto";
import {
  type CreateEventDto,
  type UpdateEventDto,
  type Event,
  type EventStatus,
} from "@teranga/shared-types";
import { eventRepository, type EventFilters } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { type PaginationParams, type PaginatedResult } from "@/repositories/base.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  ForbiddenError,
  ValidationError,
} from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

// ─── Slug generation ─────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function generateSlug(title: string): string {
  const base = slugify(title);
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 hex chars
  return `${base}-${suffix}`;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class EventService extends BaseService {
  async create(dto: CreateEventDto, user: AuthUser): Promise<Event> {
    this.requirePermission(user, "event:create");

    // Verify organization exists and user belongs to it
    const org = await organizationRepository.findByIdOrThrow(dto.organizationId);
    if (user.organizationId !== org.id && !user.roles.includes("super_admin")) {
      throw new ForbiddenError("You do not belong to this organization");
    }

    // Validate dates
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new ValidationError("End date must be after start date");
    }

    const slug = generateSlug(dto.title);

    const event = await eventRepository.create({
      ...dto,
      slug,
      registeredCount: 0,
      checkedInCount: 0,
      createdBy: user.uid,
      updatedBy: user.uid,
      publishedAt: null,
    } as Omit<Event, "id" | "createdAt" | "updatedAt">);

    eventBus.emit("event.created", {
      event,
      organizationId: dto.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return event;
  }

  async getById(eventId: string, user?: AuthUser): Promise<Event> {
    const event = await eventRepository.findByIdOrThrow(eventId);

    // Published public events are visible to everyone
    if (event.status === "published" && event.isPublic) return event;

    // Non-public or draft events require authentication and event:read
    if (!user) throw new ForbiddenError("Authentication required to view this event");
    this.requirePermission(user, "event:read");

    return event;
  }

  async getBySlug(slug: string): Promise<Event> {
    const event = await eventRepository.findBySlug(slug);
    if (!event) {
      const { NotFoundError } = await import("@/errors/app-error");
      throw new NotFoundError("Event", slug);
    }
    return event;
  }

  async listPublished(
    filters: EventFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Event>> {
    return eventRepository.findPublished(filters, pagination);
  }

  async listByOrganization(
    organizationId: string,
    user: AuthUser,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Event>> {
    this.requirePermission(user, "event:read");

    if (user.organizationId !== organizationId && !user.roles.includes("super_admin")) {
      throw new ForbiddenError("Access denied to this organization's events");
    }

    return eventRepository.findByOrganization(organizationId, pagination);
  }

  async update(eventId: string, dto: UpdateEventDto, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Cannot update cancelled/archived events
    if (event.status === "cancelled" || event.status === "archived") {
      throw new ValidationError(`Cannot update an event with status '${event.status}'`);
    }

    // Validate dates if both are provided or one changes
    const startDate = dto.startDate ?? event.startDate;
    const endDate = dto.endDate ?? event.endDate;
    if (new Date(endDate) <= new Date(startDate)) {
      throw new ValidationError("End date must be after start date");
    }

    await eventRepository.update(eventId, {
      ...dto,
      updatedBy: user.uid,
    } as Partial<Event>);

    eventBus.emit("event.updated", {
      eventId,
      organizationId: event.organizationId,
      changes: dto as Record<string, unknown>,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  async publish(eventId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:publish");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    if (event.status !== "draft") {
      throw new ValidationError(`Cannot publish event with status '${event.status}'. Only draft events can be published.`);
    }

    // Validate event is ready for publishing
    if (!event.title || !event.startDate || !event.endDate || !event.location) {
      throw new ValidationError("Event must have title, dates, and location before publishing");
    }

    await eventRepository.publish(eventId, user.uid);

    // Re-fetch to get full published state for the event payload
    const published = await eventRepository.findByIdOrThrow(eventId);
    eventBus.emit("event.published", {
      event: published,
      organizationId: event.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  async cancel(eventId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    if (event.status === "cancelled" || event.status === "archived") {
      throw new ValidationError(`Event is already ${event.status}`);
    }

    await eventRepository.update(eventId, {
      status: "cancelled" as EventStatus,
      updatedBy: user.uid,
    } as Partial<Event>);

    eventBus.emit("event.cancelled", {
      eventId,
      organizationId: event.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  async archive(eventId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:delete");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    await eventRepository.softDelete(eventId, "status", "archived");

    eventBus.emit("event.archived", {
      eventId,
      organizationId: event.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

}

export const eventService = new EventService();
