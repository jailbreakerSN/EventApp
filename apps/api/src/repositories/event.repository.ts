import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "./base.repository";
import { type Event, type EventStatus, type EventCategory } from "@teranga/shared-types";

export interface EventFilters {
  organizationId?: string;
  status?: EventStatus;
  category?: EventCategory;
  isPublic?: boolean;
  isFeatured?: boolean;
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
      whereFilters.push({ field: "organizationId", op: "==" as const, value: filters.organizationId });
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
}

export const eventRepository = new EventRepository();
