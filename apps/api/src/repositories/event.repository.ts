import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "./base.repository";
import {
  type Event,
  type EventStatus,
  type EventCategory,
  type EventFormat,
} from "@teranga/shared-types";

export interface EventFilters {
  organizationId?: string;
  status?: EventStatus;
  category?: EventCategory;
  isPublic?: boolean;
  isFeatured?: boolean;
}

export interface EventSearchFilters {
  category?: EventCategory;
  format?: EventFormat;
  organizationId?: string;
  isFeatured?: boolean;
  dateFrom?: string;
  dateTo?: string;
  city?: string;
  country?: string;
  tags?: string[];
}

export class EventRepository extends BaseRepository<Event> {
  constructor() {
    super(COLLECTIONS.EVENTS, "Event");
  }

  async findPublished(
    filters: EventFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Event>> {
    const whereFilters = [
      { field: "status", op: "==" as const, value: "published" },
      { field: "isPublic", op: "==" as const, value: true },
    ];

    if (filters.category) {
      whereFilters.push({ field: "category", op: "==" as const, value: filters.category });
    }
    if (filters.organizationId) {
      whereFilters.push({
        field: "organizationId",
        op: "==" as const,
        value: filters.organizationId,
      });
    }
    if (filters.isFeatured !== undefined) {
      whereFilters.push({ field: "isFeatured", op: "==" as const, value: filters.isFeatured });
    }

    return this.findMany(whereFilters, { ...pagination, orderBy: "startDate", orderDir: "asc" });
  }

  async findByOrganization(
    organizationId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Event>> {
    return this.findMany(
      [{ field: "organizationId", op: "==", value: organizationId }],
      pagination,
    );
  }

  /**
   * Count active events (draft + published) for an organization.
   * Used for plan limit enforcement.
   */
  async countActiveByOrganization(organizationId: string): Promise<number> {
    const result = await this.findMany(
      [
        { field: "organizationId", op: "==", value: organizationId },
        { field: "status", op: "in", value: ["draft", "published"] },
      ],
      { page: 1, limit: 1, orderBy: "createdAt", orderDir: "desc" },
    );
    return result.meta.total;
  }

  async findBySlug(slug: string): Promise<Event | null> {
    return this.findOne([{ field: "slug", op: "==", value: slug }]);
  }

  async publish(id: string, userId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.update(id, {
      status: "published" as EventStatus,
      publishedAt: now,
      updatedBy: userId,
    } as Partial<Event>);
  }

  async unpublish(id: string, userId: string): Promise<void> {
    await this.update(id, {
      status: "draft" as EventStatus,
      publishedAt: null,
      updatedBy: userId,
    } as Partial<Event>);
  }

  async search(
    filters: EventSearchFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Event>> {
    const whereFilters: Array<{
      field: string;
      op: "==" | ">=" | "<=" | "array-contains-any";
      value: unknown;
    }> = [
      { field: "status", op: "==", value: "published" },
      { field: "isPublic", op: "==", value: true },
    ];

    if (filters.category) {
      whereFilters.push({ field: "category", op: "==", value: filters.category });
    }
    if (filters.format) {
      whereFilters.push({ field: "format", op: "==", value: filters.format });
    }
    if (filters.organizationId) {
      whereFilters.push({ field: "organizationId", op: "==", value: filters.organizationId });
    }
    if (filters.isFeatured !== undefined) {
      whereFilters.push({ field: "isFeatured", op: "==", value: filters.isFeatured });
    }
    if (filters.dateFrom) {
      whereFilters.push({ field: "startDate", op: ">=", value: filters.dateFrom });
    }
    if (filters.dateTo) {
      whereFilters.push({ field: "startDate", op: "<=", value: filters.dateTo });
    }
    if (filters.city) {
      whereFilters.push({ field: "location.city", op: "==", value: filters.city });
    }
    if (filters.country) {
      whereFilters.push({ field: "location.country", op: "==", value: filters.country });
    }
    if (filters.tags && filters.tags.length > 0) {
      // Firestore array-contains-any: find events matching ANY of the tags (max 30)
      whereFilters.push({
        field: "tags",
        op: "array-contains-any",
        value: filters.tags.slice(0, 30),
      });
    }

    return this.findMany(whereFilters, {
      ...pagination,
      orderBy: pagination.orderBy ?? "startDate",
      orderDir: pagination.orderDir ?? "asc",
    });
  }
}

export const eventRepository = new EventRepository();
