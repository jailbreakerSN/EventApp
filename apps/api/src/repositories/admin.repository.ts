import { db, COLLECTIONS } from "@/config/firebase";
import type { PaginationParams, PaginatedResult, WhereClause } from "./base.repository";
import type {
  UserProfile,
  Organization,
  Event,
  AuditLogEntry,
  PlatformStats,
  Venue,
  Payment,
  Subscription,
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

  // ── Payments ────────────────────────────────────────────────────────────
  // Cross-org payment listing behind `platform:manage`. Lets the
  // `payments.failed` inbox deep-link land on a concrete list of
  // failed payments instead of the audit log — which may not carry
  // historical entries for payments written before the audit listener
  // was wired up.
  async listAllPayments(
    filters: {
      status?: string;
      method?: string;
      organizationId?: string;
      eventId?: string;
    },
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Payment>> {
    const clauses: WhereClause[] = [];
    if (filters.status) {
      clauses.push({ field: "status", op: "==", value: filters.status });
    }
    if (filters.method) {
      clauses.push({ field: "method", op: "==", value: filters.method });
    }
    if (filters.organizationId) {
      clauses.push({ field: "organizationId", op: "==", value: filters.organizationId });
    }
    if (filters.eventId) {
      clauses.push({ field: "eventId", op: "==", value: filters.eventId });
    }
    return this.paginatedQuery<Payment>(COLLECTIONS.PAYMENTS, clauses, pagination);
  }

  // ── Subscriptions ───────────────────────────────────────────────────────
  // Cross-org subscription listing. Powers the `past_due` deep-link
  // on /admin/subscriptions — previously the inbox card landed on a
  // summary-only page with no way to see which orgs were in arrears.
  async listAllSubscriptions(
    filters: { status?: string; plan?: string },
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Subscription>> {
    const clauses: WhereClause[] = [];
    if (filters.status) {
      clauses.push({ field: "status", op: "==", value: filters.status });
    }
    if (filters.plan) {
      clauses.push({ field: "plan", op: "==", value: filters.plan });
    }
    return this.paginatedQuery<Subscription>(COLLECTIONS.SUBSCRIPTIONS, clauses, pagination);
  }

  // ── Audit Logs ──────────────────────────────────────────────────────────

  async listAuditLogs(
    filters: {
      action?: string;
      actorId?: string;
      resourceType?: string;
      resourceId?: string;
      organizationId?: string;
      /**
       * T2.6 — free-text search term (lowercased, trimmed upstream).
       * Implementation: fetch up to 10x the requested page from
       * Firestore (server-side filtered by the structured fields),
       * then substring-match the projection in memory. Firestore has
       * no native text search; this is the idiomatic tradeoff for
       * admin observability — acceptable for a collection bounded by
       * retention policies (~ low six-figure row count) without
       * introducing an external search backend.
       */
      search?: string;
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
    if (filters.resourceId) {
      clauses.push({ field: "resourceId", op: "==", value: filters.resourceId });
    }
    if (filters.organizationId) {
      clauses.push({ field: "organizationId", op: "==", value: filters.organizationId });
    }
    if (filters.dateFrom) {
      clauses.push({ field: "timestamp", op: ">=", value: filters.dateFrom });
    }
    if (filters.dateTo) {
      clauses.push({ field: "timestamp", op: "<=", value: filters.dateTo });
    }

    // T2.6 fast path — no search term means the server-side page is
    // already the answer. Keeps the common case at the same cost it
    // was before this PR.
    if (!filters.search) {
      return this.paginatedQuery<AuditLogEntry>(COLLECTIONS.AUDIT_LOGS, clauses, {
        ...pagination,
        orderBy: pagination.orderBy ?? "timestamp",
        orderDir: pagination.orderDir ?? "desc",
      });
    }

    // T2.6 search path — fetch a 10x candidate window + filter in-mem.
    // The multiplier caps worst-case "search term never matches" at
    // 10 × limit rows scanned per page navigation, well under the 500
    // read budget we target for admin queries. If an operator hits
    // this ceiling consistently they should narrow by resourceType /
    // date range first; the UI hints that explicitly.
    const scanCap = Math.min(500, pagination.limit ? pagination.limit * 10 : 500);
    const search = filters.search.toLowerCase();
    const { page = 1, limit = 50 } = pagination;

    let query: Query<DocumentData> = db.collection(COLLECTIONS.AUDIT_LOGS);
    for (const clause of clauses) {
      query = query.where(clause.field, clause.op as WhereFilterOp, clause.value);
    }
    query = query.orderBy("timestamp", "desc").limit(scanCap);
    const snap = await query.get();
    const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditLogEntry);

    const matched = candidates.filter((row) => {
      // Project the row into a searchable haystack. action + actorId
      // + resourceType + resourceId + organizationId are already
      // structured filters; search adds free-text on everything else
      // that matters in practice (details JSON, actor metadata).
      const haystacks: string[] = [
        row.action ?? "",
        row.actorId ?? "",
        row.resourceType ?? "",
        row.resourceId ?? "",
        row.organizationId ?? "",
      ];
      if (row.details) {
        try {
          haystacks.push(JSON.stringify(row.details).toLowerCase());
        } catch {
          // Ignore unserialisable details — shouldn't happen, but we
          // never want a bad row to break the whole search.
        }
      }
      return haystacks.some((h) => h.toLowerCase().includes(search));
    });

    const total = matched.length;
    const start = (page - 1) * limit;
    const data = matched.slice(start, start + limit);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
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
