import { COLLECTIONS } from "@/config/firebase";
import {
  BaseRepository,
  type PaginatedResult,
  type PaginationParams,
  type WhereClause,
} from "./base.repository";
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
  /**
   * Single normalised token for full-text-style filtering against
   * `searchKeywords[]` via Firestore `array-contains`. Caller must derive
   * via `pickSearchToken()` so the same normalisation pipeline runs at
   * write and read time. Mutually exclusive with `tags` at query time —
   * Firestore allows only one array-membership operator per query, so
   * when both are present this filter wins (caller is responsible for
   * deciding the override; the repository does not silently fall back).
   */
  searchToken?: string;
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

    const result = await this.findMany(whereFilters, {
      ...pagination,
      orderBy: "startDate",
      orderDir: "asc",
    });
    // Defense-in-depth post-filter: parents should never be `published`
    // in the first place (see EventService.publishSeries), but if a
    // pre-B1 event or a data-repair script leaves one in that state,
    // make sure it can't leak onto participant discovery.
    return {
      ...result,
      data: result.data.filter((e) => !e.isRecurringParent),
    };
  }

  async findByOrganization(
    organizationId: string,
    pagination: PaginationParams,
    filters: { category?: EventCategory; status?: EventStatus } = {},
  ): Promise<PaginatedResult<Event>> {
    const whereFilters: WhereClause[] = [
      { field: "organizationId", op: "==", value: organizationId },
    ];
    if (filters.category) {
      whereFilters.push({ field: "category", op: "==", value: filters.category });
    }
    if (filters.status) {
      whereFilters.push({ field: "status", op: "==", value: filters.status });
    }
    return this.findMany(whereFilters, pagination);
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
      op: "==" | ">=" | "<=" | "array-contains" | "array-contains-any";
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
    // searchKeywords + tags both consume the single array-membership slot
    // Firestore offers per query. searchToken (derived from `q`) wins when
    // both are present — full-text intent dominates tag faceting.
    if (filters.searchToken) {
      whereFilters.push({
        field: "searchKeywords",
        op: "array-contains",
        value: filters.searchToken,
      });
    } else if (filters.tags && filters.tags.length > 0) {
      // Firestore array-contains-any: find events matching ANY of the tags (max 30)
      whereFilters.push({
        field: "tags",
        op: "array-contains-any",
        value: filters.tags.slice(0, 30),
      });
    }

    const result = await this.findMany(whereFilters, {
      ...pagination,
      orderBy: pagination.orderBy ?? "startDate",
      orderDir: pagination.orderDir ?? "asc",
    });
    // Phase 7+ item #B1 — defense-in-depth filter. Recurring-series
    // parents (`isRecurringParent: true`) are organizational anchors, not
    // registerable events. They should never reach a participant search
    // surface; `publishSeries` already keeps them as `status: "draft"` so
    // the where-clause above normally excludes them, but this post-filter
    // catches any legacy or data-repair path that leaves one published.
    // Same rationale + same filter as `findPublished()`.
    return {
      ...result,
      data: result.data.filter((e) => !e.isRecurringParent),
    };
  }
}

export const eventRepository = new EventRepository();
