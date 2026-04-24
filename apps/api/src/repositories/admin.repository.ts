import { db, COLLECTIONS } from "@/config/firebase";
import type { PaginationParams, PaginatedResult, WhereClause } from "./base.repository";
import type {
  UserProfile,
  Organization,
  Event,
  AuditLogEntry,
  PlatformStats,
  Venue,
} from "@teranga/shared-types";
import type { DocumentData, Query, WhereFilterOp } from "firebase-admin/firestore";

// ─── Admin Repository ───────────────────────────────────────────────────────
// Cross-collection queries for platform-wide administration.
// Unlike BaseRepository, this queries multiple collections directly.

class AdminRepository {
  // ── Platform Stats ──────────────────────────────────────────────────────

  async getPlatformStats(): Promise<PlatformStats> {
    const [users, orgs, events, registrations, _payments, venues] = await Promise.all([
      db.collection(COLLECTIONS.USERS).count().get(),
      db.collection(COLLECTIONS.ORGANIZATIONS).count().get(),
      db.collection(COLLECTIONS.EVENTS).count().get(),
      db.collection(COLLECTIONS.REGISTRATIONS).count().get(),
      db.collection(COLLECTIONS.PAYMENTS).where("status", "==", "succeeded").count().get(),
      db.collection(COLLECTIONS.VENUES).where("status", "==", "approved").count().get(),
    ]);

    // Sum total revenue from succeeded payments
    let totalRevenue = 0;
    const paymentSnap = await db
      .collection(COLLECTIONS.PAYMENTS)
      .where("status", "==", "succeeded")
      .select("amount")
      .get();
    for (const doc of paymentSnap.docs) {
      totalRevenue += (doc.data().amount as number) ?? 0;
    }

    return {
      totalUsers: users.data().count,
      totalOrganizations: orgs.data().count,
      totalEvents: events.data().count,
      totalRegistrations: registrations.data().count,
      totalRevenue,
      activeVenues: venues.data().count,
    };
  }

  // ── Users ───────────────────────────────────────────────────────────────

  async listAllUsers(
    filters: { q?: string; role?: string; isActive?: boolean },
    pagination: PaginationParams,
  ): Promise<PaginatedResult<UserProfile>> {
    // UserProfile uses `uid` as its ID field, not `id`.
    // Map Firestore doc ID to `uid` so the type aligns.
    const result = await this.paginatedQuery<UserProfile & { id: string }>(
      COLLECTIONS.USERS,
      this.buildUserFilters(filters),
      pagination,
    );
    return {
      ...result,
      data: result.data.map(({ id, ...rest }) => ({
        ...rest,
        uid: rest.uid ?? id,
      })) as UserProfile[],
    };
  }

  private buildUserFilters(filters: {
    q?: string;
    role?: string;
    isActive?: boolean;
  }): WhereClause[] {
    const clauses: WhereClause[] = [];
    if (filters.role) {
      clauses.push({ field: "roles", op: "array-contains", value: filters.role });
    }
    if (filters.isActive !== undefined) {
      clauses.push({ field: "isActive", op: "==", value: filters.isActive });
    }
    // Note: Firestore doesn't support text search natively.
    // For q, we use a prefix match on email (most common admin search pattern).
    // Full-text search would require Algolia or similar.
    return clauses;
  }

  // ── Organizations ───────────────────────────────────────────────────────

  async listAllOrganizations(
    filters: { q?: string; plan?: string; isVerified?: boolean; isActive?: boolean },
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Organization>> {
    const clauses: WhereClause[] = [];
    if (filters.plan) {
      clauses.push({ field: "plan", op: "==", value: filters.plan });
    }
    if (filters.isVerified !== undefined) {
      clauses.push({ field: "isVerified", op: "==", value: filters.isVerified });
    }
    if (filters.isActive !== undefined) {
      clauses.push({ field: "isActive", op: "==", value: filters.isActive });
    }
    return this.paginatedQuery<Organization>(COLLECTIONS.ORGANIZATIONS, clauses, pagination);
  }

  // ── Events ──────────────────────────────────────────────────────────────

  async listAllEvents(
    filters: { q?: string; status?: string; organizationId?: string },
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Event>> {
    const clauses: WhereClause[] = [];
    if (filters.status) {
      clauses.push({ field: "status", op: "==", value: filters.status });
    }
    if (filters.organizationId) {
      clauses.push({ field: "organizationId", op: "==", value: filters.organizationId });
    }
    return this.paginatedQuery<Event>(COLLECTIONS.EVENTS, clauses, pagination);
  }

  // ── Venues ──────────────────────────────────────────────────────────────
  // Returns the full Venue document (not the projected `{id,name,slug,address.city}`
  // shape the previous version returned for the command palette). The
  // command-palette `globalSearch` only reads name/slug/address.city so
  // promoting the return type is backwards-compatible, while the admin
  // venues page now has a real moderation surface that includes
  // `pending` / `suspended` rows the public `/v1/venues` endpoint
  // deliberately hides.
  async listAllVenues(
    filters: {
      status?: string;
      venueType?: string;
      city?: string;
      country?: string;
      isFeatured?: boolean;
    },
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Venue>> {
    const clauses: WhereClause[] = [];
    if (filters.status) {
      clauses.push({ field: "status", op: "==", value: filters.status });
    }
    if (filters.venueType) {
      clauses.push({ field: "venueType", op: "==", value: filters.venueType });
    }
    if (filters.city) {
      clauses.push({ field: "address.city", op: "==", value: filters.city });
    }
    if (filters.country) {
      clauses.push({ field: "address.country", op: "==", value: filters.country });
    }
    if (filters.isFeatured !== undefined) {
      clauses.push({ field: "isFeatured", op: "==", value: filters.isFeatured });
    }
    return this.paginatedQuery<Venue>(COLLECTIONS.VENUES, clauses, pagination);
  }

  // ── Audit Logs ──────────────────────────────────────────────────────────

  async listAuditLogs(
    filters: {
      action?: string;
      actorId?: string;
      resourceType?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    pagination: PaginationParams,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    const clauses: WhereClause[] = [];
    if (filters.action) {
      clauses.push({ field: "action", op: "==", value: filters.action });
    }
    if (filters.actorId) {
      clauses.push({ field: "actorId", op: "==", value: filters.actorId });
    }
    if (filters.resourceType) {
      clauses.push({ field: "resourceType", op: "==", value: filters.resourceType });
    }
    if (filters.dateFrom) {
      clauses.push({ field: "timestamp", op: ">=", value: filters.dateFrom });
    }
    if (filters.dateTo) {
      clauses.push({ field: "timestamp", op: "<=", value: filters.dateTo });
    }
    return this.paginatedQuery<AuditLogEntry>(COLLECTIONS.AUDIT_LOGS, clauses, {
      ...pagination,
      orderBy: pagination.orderBy ?? "timestamp",
      orderDir: pagination.orderDir ?? "desc",
    });
  }

  // ── Shared paginated query helper ───────────────────────────────────────

  private async paginatedQuery<T extends { id: string }>(
    collectionName: string,
    filters: WhereClause[],
    pagination: PaginationParams,
  ): Promise<PaginatedResult<T>> {
    const { page = 1, limit = 20, orderBy = "createdAt", orderDir = "desc" } = pagination;

    let query: Query<DocumentData> = db.collection(collectionName);
    for (const filter of filters) {
      query = query.where(filter.field, filter.op as WhereFilterOp, filter.value);
    }

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    query = query
      .orderBy(orderBy, orderDir)
      .offset((page - 1) * limit)
      .limit(limit);
    const snapshot = await query.get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}

export const adminRepository = new AdminRepository();
