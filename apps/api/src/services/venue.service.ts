import crypto from "node:crypto";
import {
  type CreateVenueDto,
  type UpdateVenueDto,
  type Venue,
  type VenueQuery,
} from "@teranga/shared-types";
import { venueRepository } from "@/repositories/venue.repository";
import { type PaginatedResult } from "@/repositories/base.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ForbiddenError, ValidationError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { COLLECTIONS, db } from "@/config/firebase";

// ─── Slug generation ────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function generateSlug(name: string): string {
  const base = slugify(name);
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base}-${suffix}`;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class VenueService extends BaseService {
  async create(dto: CreateVenueDto, user: AuthUser): Promise<Venue> {
    // Admin or venue:create permission
    const hasVenueCreate = this.hasPermission(user, "venue:create");
    const hasManageAll = this.hasPermission(user, "platform:manage");

    if (!hasVenueCreate && !hasManageAll) {
      throw new ForbiddenError("Permission venue:create requise");
    }

    const slug = generateSlug(dto.name);

    // Admin-created venues are auto-approved, others pending
    const status = hasManageAll ? "approved" : "pending";

    const venue = await venueRepository.create({
      ...dto,
      slug,
      status,
      isFeatured: false,
      rating: null,
      eventCount: 0,
      createdBy: user.uid,
      updatedBy: user.uid,
    } as Omit<Venue, "id" | "createdAt" | "updatedAt">);

    eventBus.emit("venue.created", {
      venueId: venue.id,
      name: venue.name,
      hostOrganizationId: dto.hostOrganizationId ?? undefined,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return venue;
  }

  async update(venueId: string, dto: UpdateVenueDto, user: AuthUser): Promise<void> {
    const venue = await venueRepository.findByIdOrThrow(venueId);

    // Check ownership or admin
    const isOwner = venue.hostOrganizationId && user.organizationId === venue.hostOrganizationId;
    const isAdmin = this.hasPermission(user, "venue:manage_all");

    if (!isOwner && !isAdmin) {
      throw new ForbiddenError("Accès refusé à ce lieu");
    }

    if (!isOwner) {
      this.requirePermission(user, "venue:update");
    }

    await venueRepository.update(venueId, {
      ...dto,
      updatedBy: user.uid,
    } as Partial<Venue>);

    eventBus.emit("venue.updated", {
      venueId,
      changes: dto as Record<string, unknown>,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  async approve(venueId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "venue:approve");

    const venue = await venueRepository.findByIdOrThrow(venueId);

    if (venue.status !== "pending") {
      throw new ValidationError(`Impossible d'approuver un lieu avec le statut '${venue.status}'`);
    }

    await venueRepository.update(venueId, {
      status: "approved",
      updatedBy: user.uid,
    } as Partial<Venue>);

    eventBus.emit("venue.approved", {
      venueId,
      name: venue.name,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  async suspend(venueId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "venue:manage_all");

    const venue = await venueRepository.findByIdOrThrow(venueId);

    if (venue.status === "suspended") {
      throw new ValidationError("Ce lieu est déjà suspendu");
    }

    await venueRepository.update(venueId, {
      status: "suspended",
      updatedBy: user.uid,
    } as Partial<Venue>);

    eventBus.emit("venue.suspended", {
      venueId,
      name: venue.name,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  async reactivate(venueId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "venue:manage_all");

    const venue = await venueRepository.findByIdOrThrow(venueId);

    if (venue.status !== "suspended") {
      throw new ValidationError("Seuls les lieux suspendus peuvent être réactivés");
    }

    await venueRepository.update(venueId, {
      status: "approved",
      updatedBy: user.uid,
    } as Partial<Venue>);
  }

  async getById(venueId: string): Promise<Venue> {
    return venueRepository.findByIdOrThrow(venueId);
  }

  async getBySlug(slug: string): Promise<Venue | null> {
    return venueRepository.findBySlug(slug);
  }

  async listPublic(query: VenueQuery): Promise<PaginatedResult<Venue>> {
    return venueRepository.findApproved(
      {
        city: query.city,
        country: query.country,
        venueType: query.venueType,
        isFeatured: query.isFeatured,
      },
      {
        page: query.page,
        limit: query.limit,
        orderBy: query.orderBy,
        orderDir: query.orderDir,
      },
    );
  }

  async listHostVenues(user: AuthUser): Promise<PaginatedResult<Venue>> {
    if (!user.organizationId) {
      throw new ForbiddenError("Vous devez appartenir à une organisation");
    }

    return venueRepository.findByHost(user.organizationId, {
      page: 1,
      limit: 100,
      orderBy: "name",
      orderDir: "asc",
    });
  }

  async getVenueEvents(venueId: string, pagination: { page: number; limit: number }): Promise<PaginatedResult<unknown>> {
    // Verify venue exists
    await venueRepository.findByIdOrThrow(venueId);

    // Query events collection where venueId matches
    const eventsRef = db.collection(COLLECTIONS.EVENTS);
    let query = eventsRef.where("venueId", "==", venueId);

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    query = eventsRef
      .where("venueId", "==", venueId)
      .orderBy("startDate", "desc")
      .offset((pagination.page - 1) * pagination.limit)
      .limit(pagination.limit);

    const snapshot = await query.get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return {
      data,
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    };
  }
}

export const venueService = new VenueService();
