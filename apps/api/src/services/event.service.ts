import crypto from "node:crypto";
import {
  type CreateEventDto,
  type UpdateEventDto,
  type CreateTicketTypeDto,
  type UpdateTicketTypeDto,
  type CreateAccessZoneDto,
  type UpdateAccessZoneDto,
  type CloneEventDto,
  type Event,
  type EventStatus,
  type EventSearchQuery,
  type Organization,
} from "@teranga/shared-types";
import {
  eventRepository,
  type EventFilters,
  type EventSearchFilters,
} from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { venueRepository } from "@/repositories/venue.repository";
import { type PaginationParams, type PaginatedResult } from "@/repositories/base.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ForbiddenError, ValidationError, PlanLimitError } from "@/errors/app-error";
import { db } from "@/config/firebase";
import { COLLECTIONS } from "@/config/firebase";
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
      throw new ForbiddenError("Vous ne faites pas partie de cette organisation");
    }

    // Check plan limit for active events
    await this.checkEventLimit(org);

    // Validate dates
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new ValidationError("La date de fin doit être postérieure à la date de début");
    }

    const slug = generateSlug(dto.title);

    // Resolve venue if provided
    let venueName: string | null = null;
    if (dto.venueId) {
      const venue = await venueRepository.findByIdOrThrow(dto.venueId);
      if (venue.status !== "approved") {
        throw new ValidationError("Le lieu sélectionné n'est pas approuvé");
      }
      venueName = venue.name;
    }

    const event = await eventRepository.create({
      ...dto,
      slug,
      venueName: venueName ?? dto.venueName ?? null,
      registeredCount: 0,
      checkedInCount: 0,
      createdBy: user.uid,
      updatedBy: user.uid,
      publishedAt: null,
    } as Omit<Event, "id" | "createdAt" | "updatedAt">);

    // Increment venue event counter
    if (dto.venueId) {
      await venueRepository.increment(dto.venueId, "eventCount", 1);
    }

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

    // Non-public or draft events require authentication + org membership
    if (!user) throw new ForbiddenError("Authentification requise pour voir cet événement");
    this.requirePermission(user, "event:read");
    this.requireOrganizationAccess(user, event.organizationId);

    return event;
  }

  async getBySlug(slug: string, user?: AuthUser): Promise<Event> {
    const event = await eventRepository.findBySlug(slug);
    if (!event) {
      const { NotFoundError } = await import("@/errors/app-error");
      throw new NotFoundError("Event", slug);
    }

    // Same visibility logic as getById
    if (event.status === "published" && event.isPublic) return event;

    if (!user) throw new ForbiddenError("Authentification requise pour voir cet événement");
    this.requirePermission(user, "event:read");
    this.requireOrganizationAccess(user, event.organizationId);

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
      throw new ForbiddenError("Accès refusé aux événements de cette organisation");
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
      throw new ValidationError("La date de fin doit être postérieure à la date de début");
    }

    // Handle venue change
    const updateData: Partial<Event> & Record<string, unknown> = {
      ...dto,
      updatedBy: user.uid,
    };

    if (dto.venueId !== undefined && dto.venueId !== event.venueId) {
      if (dto.venueId) {
        // New venue assigned
        const venue = await venueRepository.findByIdOrThrow(dto.venueId);
        if (venue.status !== "approved") {
          throw new ValidationError("Le lieu sélectionné n'est pas approuvé");
        }
        updateData.venueName = venue.name;
        await venueRepository.increment(dto.venueId, "eventCount", 1);
      } else {
        // Venue removed
        updateData.venueName = null;
      }
      // Decrement old venue counter
      if (event.venueId) {
        await venueRepository.increment(event.venueId, "eventCount", -1);
      }
    }

    await eventRepository.update(eventId, updateData as Partial<Event>);

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
      throw new ValidationError(
        `Cannot publish event with status '${event.status}'. Only draft events can be published.`,
      );
    }

    // Validate event is ready for publishing
    if (!event.title || !event.startDate || !event.endDate || !event.location) {
      throw new ValidationError(
        "L'événement doit avoir un titre, des dates et un lieu avant publication",
      );
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
      throw new ValidationError(
        `Cannot unpublish event with status '${event.status}'. Only published events can be unpublished.`,
      );
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

    const ticketId = `tt-${crypto.randomBytes(4).toString("hex")}`;
    const newTicketType = { ...dto, id: ticketId, soldCount: 0 };

    const updatedEvent = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      if (event.status === "cancelled" || event.status === "archived") {
        throw new ValidationError(`Cannot modify ticket types on a ${event.status} event`);
      }

      // Gate paid tickets behind plan feature
      if (dto.price && dto.price > 0) {
        const org = await organizationRepository.findByIdOrThrow(event.organizationId);
        this.requirePlanFeature(org, "paidTickets");
      }

      const updatedTicketTypes = [...event.ticketTypes, newTicketType];
      tx.update(docRef, { ticketTypes: updatedTicketTypes, updatedBy: user.uid });
      return { ...event, ticketTypes: updatedTicketTypes };
    });

    eventBus.emit("ticket_type.added", {
      eventId,
      organizationId: updatedEvent.organizationId,
      ticketTypeId: ticketId,
      ticketTypeName: dto.name,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return updatedEvent;
  }

  async updateTicketType(
    eventId: string,
    ticketTypeId: string,
    dto: UpdateTicketTypeDto,
    user: AuthUser,
  ): Promise<Event> {
    this.requirePermission(user, "event:update");

    const updatedEvent = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const index = event.ticketTypes.findIndex((t) => t.id === ticketTypeId);
      if (index === -1) {
        throw new ValidationError(`Type de billet « ${ticketTypeId} » introuvable`);
      }

      const updatedTicketTypes = [...event.ticketTypes];
      updatedTicketTypes[index] = { ...updatedTicketTypes[index], ...dto };
      tx.update(docRef, { ticketTypes: updatedTicketTypes, updatedBy: user.uid });
      return { ...event, ticketTypes: updatedTicketTypes };
    });

    eventBus.emit("ticket_type.updated", {
      eventId,
      organizationId: updatedEvent.organizationId,
      ticketTypeId,
      changes: dto as Record<string, unknown>,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return updatedEvent;
  }

  async removeTicketType(eventId: string, ticketTypeId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const result = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const ticketType = event.ticketTypes.find((t) => t.id === ticketTypeId);
      if (!ticketType) {
        throw new ValidationError(`Type de billet « ${ticketTypeId} » introuvable`);
      }
      if (ticketType.soldCount > 0) {
        throw new ValidationError(
          "Impossible de supprimer un type de billet avec des ventes existantes",
        );
      }

      const updatedTicketTypes = event.ticketTypes.filter((t) => t.id !== ticketTypeId);
      tx.update(docRef, { ticketTypes: updatedTicketTypes, updatedBy: user.uid });
      return { organizationId: event.organizationId, ticketTypeName: ticketType.name };
    });

    eventBus.emit("ticket_type.removed", {
      eventId,
      organizationId: result.organizationId,
      ticketTypeId,
      ticketTypeName: result.ticketTypeName,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Access Zone Management ──────────────────────────────────────────────

  async addAccessZone(eventId: string, dto: CreateAccessZoneDto, user: AuthUser): Promise<Event> {
    this.requirePermission(user, "event:update");

    const zoneId = `zone-${crypto.randomBytes(4).toString("hex")}`;
    const newZone = { ...dto, id: zoneId };

    const updatedEvent = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      if (event.status === "cancelled" || event.status === "archived") {
        throw new ValidationError(`Cannot modify access zones on a ${event.status} event`);
      }

      const updatedZones = [...event.accessZones, newZone];
      tx.update(docRef, { accessZones: updatedZones, updatedBy: user.uid });
      return { ...event, accessZones: updatedZones };
    });

    eventBus.emit("access_zone.added", {
      eventId,
      organizationId: updatedEvent.organizationId,
      zoneId,
      zoneName: dto.name,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return updatedEvent;
  }

  async updateAccessZone(
    eventId: string,
    zoneId: string,
    dto: UpdateAccessZoneDto,
    user: AuthUser,
  ): Promise<Event> {
    this.requirePermission(user, "event:update");

    const updatedEvent = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const index = event.accessZones.findIndex((z) => z.id === zoneId);
      if (index === -1) {
        throw new ValidationError(`Access zone '${zoneId}' not found`);
      }

      const updatedZones = [...event.accessZones];
      updatedZones[index] = { ...updatedZones[index], ...dto };
      tx.update(docRef, { accessZones: updatedZones, updatedBy: user.uid });
      return { ...event, accessZones: updatedZones };
    });

    eventBus.emit("access_zone.updated", {
      eventId,
      organizationId: updatedEvent.organizationId,
      zoneId,
      changes: dto as Record<string, unknown>,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return updatedEvent;
  }

  async removeAccessZone(eventId: string, zoneId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const result = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const zone = event.accessZones.find((z) => z.id === zoneId);
      if (!zone) {
        throw new ValidationError(`Access zone '${zoneId}' not found`);
      }

      const updatedZones = event.accessZones.filter((z) => z.id !== zoneId);
      tx.update(docRef, { accessZones: updatedZones, updatedBy: user.uid });
      return { organizationId: event.organizationId, zoneName: zone.name };
    });

    eventBus.emit("access_zone.removed", {
      eventId,
      organizationId: result.organizationId,
      zoneId,
      zoneName: result.zoneName,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Clone Event ─────────────────────────────────────────────────────────

  async clone(eventId: string, dto: CloneEventDto, user: AuthUser): Promise<Event> {
    this.requirePermission(user, "event:create");

    const source = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, source.organizationId);

    // Check plan limits for event count
    const org = await organizationRepository.findByIdOrThrow(source.organizationId);
    await this.checkEventLimit(org);

    // Validate new dates
    if (new Date(dto.newEndDate) <= new Date(dto.newStartDate)) {
      throw new ValidationError("La date de fin doit être postérieure à la date de début");
    }

    const title = dto.newTitle ?? `${source.title} (copie)`;
    const slug = generateSlug(title);

    // Reset ticket type counters and generate new IDs
    const ticketTypes =
      dto.copyTicketTypes !== false
        ? source.ticketTypes.map((t) => ({
            ...t,
            id: `tt-${crypto.randomBytes(4).toString("hex")}`,
            soldCount: 0,
          }))
        : [];

    const accessZones =
      dto.copyAccessZones !== false
        ? source.accessZones.map((z) => ({
            ...z,
            id: `zone-${crypto.randomBytes(4).toString("hex")}`,
          }))
        : [];

    const cloned = await eventRepository.create({
      organizationId: source.organizationId,
      title,
      slug,
      description: source.description,
      shortDescription: source.shortDescription ?? null,
      coverImageURL: source.coverImageURL ?? null,
      bannerImageURL: source.bannerImageURL ?? null,
      category: source.category,
      tags: source.tags,
      format: source.format,
      status: "draft" as EventStatus,
      location: source.location,
      startDate: dto.newStartDate,
      endDate: dto.newEndDate,
      timezone: source.timezone,
      ticketTypes,
      accessZones,
      maxAttendees: source.maxAttendees ?? null,
      registeredCount: 0,
      checkedInCount: 0,
      isPublic: source.isPublic,
      isFeatured: false,
      requiresApproval: source.requiresApproval,
      templateId: source.templateId ?? null,
      createdBy: user.uid,
      updatedBy: user.uid,
      publishedAt: null,
    } as Omit<Event, "id" | "createdAt" | "updatedAt">);

    eventBus.emit("event.cloned", {
      sourceEventId: eventId,
      newEventId: cloned.id,
      organizationId: source.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return cloned;
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  async search(query: EventSearchQuery, _user?: AuthUser): Promise<PaginatedResult<Event>> {
    // Normalize tags: accept comma-separated string or array
    const tags = query.tags
      ? Array.isArray(query.tags)
        ? query.tags
        : query.tags.split(",").map((t) => t.trim())
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

  // ─── Plan Limit Helpers ────────────────────────────────────────────────────

  private async checkEventLimit(org: Organization): Promise<void> {
    const { allowed, current, limit } = this.checkPlanLimit(
      org,
      "events",
      await eventRepository.countActiveByOrganization(org.id),
    );
    if (!allowed) {
      const planLabel = org.effectivePlanKey ?? org.plan;
      throw new PlanLimitError(`Maximum ${limit} événements actifs sur le plan ${planLabel}`, {
        current,
        max: limit,
        plan: planLabel,
      });
    }
  }
}

export const eventService = new EventService();
