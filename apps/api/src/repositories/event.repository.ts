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
  /**
   * Single category sent to Firestore as a `==` equality filter. The
   * service-level multi-select (doctrine MUST for marketplace discovery)
   * is resolved BEFORE this layer: when 2+ categories are selected, the
   * service drops `category` from the Firestore filter set and applies
   * a post-fetch filter on the bounded result page instead. Reason:
   * Firestore's `in` operator can't combine with `array-contains` /
   * `array-contains-any` in a single query, so multi-category +
   * searchKeywords / tags would otherwise need a different query
   * dispatch shape that the index auditor can't reason about.
   */
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
    // Firestore allows only one array-membership operator per query, so
    // searchKeywords (full-text) and tags (faceting) are MUTUALLY exclusive.
    // We dispatch into two separate query helpers so the static index audit
    // sees two distinct query shapes — combining them in one builder caused
    // the auditor to compute a (impossible) maximal shape with both array
    // operators present. searchToken always wins when both are supplied.
    const warnings: string[] = [];
    if (filters.searchToken) {
      if (filters.tags && filters.tags.length > 0) {
        warnings.push("TAGS_IGNORED_DUE_TO_SEARCH");
      }
      const result = await this.searchByKeyword(filters, pagination);
      return this.attachWarningsAndStripParents(result, warnings);
    }

    if (filters.tags && filters.tags.length > 30) {
      warnings.push(`TAGS_TRUNCATED:30 (received ${filters.tags.length})`);
    }
    const result = await this.searchByTagsOrFilters(filters, pagination);
    return this.attachWarningsAndStripParents(result, warnings);
  }

  /**
   * searchKeywords[] array-contains branch. Used when `q` resolves to a
   * non-empty token via pickSearchToken. Disjoint from searchByTagsOrFilters:
   * the static index auditor sees this branch's where() chain in isolation,
   * so the maximal index it requires is composable with `searchKeywords`
   * alone.
   */
  private async searchByKeyword(
    filters: EventSearchFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Event>> {
    const wheres: Array<{
      field: string;
      op: "==" | ">=" | "<=" | "array-contains";
      value: unknown;
    }> = [
      { field: "status", op: "==", value: "published" },
      { field: "isPublic", op: "==", value: true },
    ];
    if (filters.category) wheres.push({ field: "category", op: "==", value: filters.category });
    if (filters.format) wheres.push({ field: "format", op: "==", value: filters.format });
    if (filters.organizationId) wheres.push({ field: "organizationId", op: "==", value: filters.organizationId });
    if (filters.isFeatured !== undefined) wheres.push({ field: "isFeatured", op: "==", value: filters.isFeatured });
    if (filters.dateFrom) wheres.push({ field: "startDate", op: ">=", value: filters.dateFrom });
    if (filters.dateTo) wheres.push({ field: "startDate", op: "<=", value: filters.dateTo });
    if (filters.city) wheres.push({ field: "location.city", op: "==", value: filters.city });
    if (filters.country) wheres.push({ field: "location.country", op: "==", value: filters.country });
    wheres.push({ field: "searchKeywords", op: "array-contains", value: filters.searchToken });
    return this.findMany(wheres, {
      ...pagination,
      orderBy: pagination.orderBy ?? "startDate",
      orderDir: pagination.orderDir ?? "asc",
    });
  }

  /**
   * tags array-contains-any branch (or no array filter when tags is empty).
   * Disjoint from searchByKeyword. Tags array is sliced to 30 to respect
   * Firestore's array-contains-any cardinality cap; the caller emits the
   * TAGS_TRUNCATED warning when the original array overflowed.
   */
  private async searchByTagsOrFilters(
    filters: EventSearchFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Event>> {
    const wheres: Array<{
      field: string;
      op: "==" | ">=" | "<=" | "array-contains-any";
      value: unknown;
    }> = [
      { field: "status", op: "==", value: "published" },
      { field: "isPublic", op: "==", value: true },
    ];
    if (filters.category) wheres.push({ field: "category", op: "==", value: filters.category });
    if (filters.format) wheres.push({ field: "format", op: "==", value: filters.format });
    if (filters.organizationId) wheres.push({ field: "organizationId", op: "==", value: filters.organizationId });
    if (filters.isFeatured !== undefined) wheres.push({ field: "isFeatured", op: "==", value: filters.isFeatured });
    if (filters.dateFrom) wheres.push({ field: "startDate", op: ">=", value: filters.dateFrom });
    if (filters.dateTo) wheres.push({ field: "startDate", op: "<=", value: filters.dateTo });
    if (filters.city) wheres.push({ field: "location.city", op: "==", value: filters.city });
    if (filters.country) wheres.push({ field: "location.country", op: "==", value: filters.country });
    if (filters.tags && filters.tags.length > 0) {
      wheres.push({ field: "tags", op: "array-contains-any", value: filters.tags.slice(0, 30) });
    }
    return this.findMany(wheres, {
      ...pagination,
      orderBy: pagination.orderBy ?? "startDate",
      orderDir: pagination.orderDir ?? "asc",
    });
  }

  // Phase 7+ item #B1 — defense-in-depth filter. Recurring-series parents
  // (`isRecurringParent: true`) are organizational anchors, not registerable
  // events. They should never reach a participant search surface; the
  // service's `publishSeries` already keeps them as `status: "draft"` so the
  // where-clause excludes them, but this post-filter catches any legacy
  // path that leaves one published. Mirrors `findPublished()`.
  private attachWarningsAndStripParents(
    result: PaginatedResult<Event>,
    warnings: string[],
  ): PaginatedResult<Event> {
    return {
      ...result,
      meta: warnings.length > 0 ? { ...result.meta, warnings } : result.meta,
      data: result.data.filter((e) => !e.isRecurringParent),
    };
  }
}

export const eventRepository = new EventRepository();
