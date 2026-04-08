import { COLLECTIONS } from "@/config/firebase";
import {
  BaseRepository,
  type PaginatedResult,
  type PaginationParams,
  type WhereClause,
} from "./base.repository";
import { type Venue, type VenueStatus, type VenueType } from "@teranga/shared-types";

// ─── Filters ────────────────────────────────────────────────────────────────

export interface VenueFilters {
  city?: string;
  country?: string;
  venueType?: VenueType;
  status?: VenueStatus;
  isFeatured?: boolean;
  hostOrganizationId?: string;
}

// ─── Repository ─────────────────────────────────────────────────────────────

export class VenueRepository extends BaseRepository<Venue> {
  constructor() {
    super(COLLECTIONS.VENUES, "Venue");
  }

  async findBySlug(slug: string): Promise<Venue | null> {
    return this.findOne([{ field: "slug", op: "==", value: slug }]);
  }

  async findApproved(
    filters: VenueFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Venue>> {
    const clauses: WhereClause[] = [
      { field: "status", op: "==", value: "approved" },
    ];

    if (filters.city) clauses.push({ field: "address.city", op: "==", value: filters.city });
    if (filters.country) clauses.push({ field: "address.country", op: "==", value: filters.country });
    if (filters.venueType) clauses.push({ field: "venueType", op: "==", value: filters.venueType });
    if (filters.isFeatured !== undefined) clauses.push({ field: "isFeatured", op: "==", value: filters.isFeatured });

    return this.findMany(clauses, pagination);
  }

  async findByHost(
    hostOrganizationId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Venue>> {
    return this.findMany(
      [{ field: "hostOrganizationId", op: "==", value: hostOrganizationId }],
      pagination,
    );
  }

  async findAll(
    filters: VenueFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Venue>> {
    const clauses: WhereClause[] = [];

    if (filters.status) clauses.push({ field: "status", op: "==", value: filters.status });
    if (filters.city) clauses.push({ field: "address.city", op: "==", value: filters.city });
    if (filters.country) clauses.push({ field: "address.country", op: "==", value: filters.country });
    if (filters.venueType) clauses.push({ field: "venueType", op: "==", value: filters.venueType });
    if (filters.isFeatured !== undefined) clauses.push({ field: "isFeatured", op: "==", value: filters.isFeatured });
    if (filters.hostOrganizationId) clauses.push({ field: "hostOrganizationId", op: "==", value: filters.hostOrganizationId });

    return this.findMany(clauses, pagination);
  }
}

export const venueRepository = new VenueRepository();
