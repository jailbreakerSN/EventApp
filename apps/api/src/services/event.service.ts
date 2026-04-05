import crypto from "node:crypto";
import {
  type CreateEventDto,
  type UpdateEventDto,
  type CreateTicketTypeDto,
  type UpdateTicketTypeDto,
  type Event,
  type EventStatus,
  type EventSearchQuery,
} from "@teranga/shared-types";
import { eventRepository, type EventFilters, type EventSearchFilters } from "@/repositories/event.repository";
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

  async unpublish(eventId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:publish");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    if (event.status !== "published") {
      throw new ValidationError(`Cannot unpublish event with status '${event.status}'. Only published events can be unpublished.`);
    }

    await eventRepository.unpublish(eventId, user.uid);

    eventBus.emit("event.unpublished", {
      eventId,
      organizationId: event.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Ticket Type Management ──────────────────────────────────────────────

  async addTicketType(eventId: string, dto: CreateTicketTypeDto, user: AuthUser): Promise<Event> {
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    if (event.status === "cancelled" || event.status === "archived") {
      throw new ValidationError(`Cannot modify ticket types on a ${event.status} event`);
    }

    const ticketId = `tt-${crypto.randomBytes(4).toString("hex")}`;
    const newTicketType = { ...dto, id: ticketId, soldCount: 0 };
    const updatedTicketTypes = [...event.ticketTypes, newTicketType];

    await eventRepository.update(eventId, {
      ticketTypes: updatedTicketTypes,
      updatedBy: user.uid,
    } as Partial<Event>);

    eventBus.emit("ticket_type.added", {
      eventId,
      organizationId: event.organizationId,
      ticketTypeId: ticketId,
      ticketTypeName: dto.name,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return { ...event, ticketTypes: updatedTicketTypes };
  }

  async updateTicketType(
    eventId: string,
    ticketTypeId: string,
    dto: UpdateTicketTypeDto,
    user: AuthUser,
  ): Promise<Event> {
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const index = event.ticketTypes.findIndex((t) => t.id === ticketTypeId);
    if (index === -1) {
      throw new ValidationError(`Ticket type '${ticketTypeId}' not found`);
    }

    const updatedTicketTypes = [...event.ticketTypes];
    updatedTicketTypes[index] = { ...updatedTicketTypes[index], ...dto };

    await eventRepository.update(eventId, {
      ticketTypes: updatedTicketTypes,
      updatedBy: user.uid,
    } as Partial<Event>);

    eventBus.emit("ticket_type.updated", {
      eventId,
      organizationId: event.organizationId,
      ticketTypeId,
      changes: dto as Record<string, unknown>,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return { ...event, ticketTypes: updatedTicketTypes };
  }

  async removeTicketType(eventId: string, ticketTypeId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const ticketType = event.ticketTypes.find((t) => t.id === ticketTypeId);
    if (!ticketType) {
      throw new ValidationError(`Ticket type '${ticketTypeId}' not found`);
    }

    if (ticketType.soldCount > 0) {
      throw new ValidationError("Cannot remove a ticket type with existing sales");
    }

    const updatedTicketTypes = event.ticketTypes.filter((t) => t.id !== ticketTypeId);

    await eventRepository.update(eventId, {
      ticketTypes: updatedTicketTypes,
      updatedBy: user.uid,
    } as Partial<Event>);

    eventBus.emit("ticket_type.removed", {
      eventId,
      organizationId: event.organizationId,
      ticketTypeId,
      ticketTypeName: ticketType.name,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  async search(
    query: EventSearchQuery,
    user?: AuthUser,
  ): Promise<PaginatedResult<Event>> {
    // Normalize tags: accept comma-separated string or array
    const tags = query.tags
      ? (Array.isArray(query.tags) ? query.tags : query.tags.split(",").map((t) => t.trim()))
      : undefined;

    const filters: EventSearchFilters = {
      category: query.category,
      format: query.format,
      organizationId: query.organizationId,
      isFeatured: query.isFeatured,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      city: query.city,
      country: query.country,
      tags,
    };

    const result = await eventRepository.search(filters, {
      page: query.page,
      limit: query.limit,
      orderBy: query.orderBy,
      orderDir: query.orderDir,
    });

    // Client-side title prefix filter (Firestore lacks full-text search)
    if (query.q) {
      const q = query.q.toLowerCase();
      result.data = result.data.filter(
        (e) => e.title.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q),
      );
      result.meta.total = result.data.length;
      result.meta.totalPages = Math.ceil(result.data.length / query.limit);
    }

    return result;
  }

}

export const eventService = new EventService();
