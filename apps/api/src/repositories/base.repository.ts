import {
  type CollectionReference,
  type DocumentData,
  type Query,
  type WhereFilterOp,
  type OrderByDirection,
  FieldValue,
} from "firebase-admin/firestore";
import { db } from "@/config/firebase";
import { NotFoundError } from "@/errors/app-error";
import { trackFirestoreReads } from "@/context/request-context";
import { withSpan } from "@/observability/sentry";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Wave 10 / W10-P4 — server-side hard cap on `findMany` page size.
 *
 * The pre-W10 codebase had several services calling `findMany(...,
 * { limit: 10000 })` to "fetch everything in one go". Those calls
 * either stalled the request (Cloud Run 60 s default request timeout)
 * for an enterprise-tier organisation or pulled ~80 MB from
 * Firestore in a single hit. The cap below is the boundary
 * `BaseRepository` enforces — callers asking for more than 1000 docs
 * get exactly 1000 + a `meta.totalPages` they can paginate through.
 *
 * Aggregate / report queries that legitimately need to scan beyond
 * the cap should use cursor pagination via `startAfter` (planned for
 * the report services) or a Pub/Sub-driven batch job.
 */
export const MAX_PAGE_SIZE = 1000;

export interface PaginationParams {
  page?: number;
  limit?: number;
  orderBy?: string;
  orderDir?: OrderByDirection;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface WhereClause {
  field: string;
  op: WhereFilterOp;
  value: unknown; // string, number, boolean, or array for "in"/"not-in"/"array-contains-any"
}

// ─── Base Repository ──────────────────────────────────────────────────────────

/**
 * Per-repository soft-delete configuration. When set, `findMany` excludes
 * documents whose `field` matches any value in `tombstones` unless the caller
 * explicitly passes `{ includeArchived: true }`.
 *
 * Defaults to `null` (no implicit exclusion) for backwards compatibility.
 * Sub-repositories opt in by setting `protected readonly softDelete = …` in
 * their constructor body or as a class field initialiser.
 *
 * See `docs/design-system/data-listing.md` § Backend primitives.
 */
export interface SoftDeleteConfig {
  field: string;
  tombstones: readonly string[];
}

export class BaseRepository<T extends { id: string }> {
  protected collection: CollectionReference<DocumentData>;
  protected resourceName: string;
  protected readonly softDelete: SoftDeleteConfig | null = null;

  constructor(collectionName: string, resourceName?: string) {
    this.collection = db.collection(collectionName);
    this.resourceName = resourceName ?? collectionName;
  }

  // ── Read ──────────────────────────────────────────────────────────────
  //
  // Sprint-3 T4.2 — every read path here calls `trackFirestoreReads()`
  // so the per-request counter on the request context reflects what
  // actually hits Firestore. The counter is flushed after request
  // completion to `firestoreUsage/{orgId}_{day}` for the cost
  // dashboard. `aggregate count()` queries count as 1 read by
  // Firestore billing semantics; document reads count per doc
  // returned. We mirror that accounting so the dashboard maps onto
  // the actual GCP bill. Ad-hoc `db.collection().get()` chains
  // outside this base class also need to call `trackFirestoreReads`
  // explicitly — see `admin.repository.ts` and the inline routes.

  async findById(id: string): Promise<T | null> {
    return withSpan({ op: "db.firestore", name: `${this.resourceName}.findById` }, async () => {
      const doc = await this.collection.doc(id).get();
      trackFirestoreReads(1);
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() } as T;
    });
  }

  async findByIdOrThrow(id: string): Promise<T> {
    const entity = await this.findById(id);
    if (!entity) throw new NotFoundError(this.resourceName, id);
    return entity;
  }

  async findMany(
    filters: WhereClause[] = [],
    pagination?: PaginationParams,
    options: { includeArchived?: boolean } = {},
  ): Promise<PaginatedResult<T>> {
    return withSpan({ op: "db.firestore", name: `${this.resourceName}.findMany` }, async () => {
      const { page = 1, orderBy = "createdAt", orderDir = "desc" } = pagination ?? {};
      // W10-P4 — clamp limit to MAX_PAGE_SIZE so a caller passing
      // `limit: 10000` gets at most 1000 docs back. The reported
      // `meta.limit` reflects the effective cap so consumers compute
      // pagination correctly.
      const limit = Math.min(pagination?.limit ?? 20, MAX_PAGE_SIZE);

      // P0.4 — when the repository declares a soft-delete config, inject
      // the tombstone filter automatically unless the caller opts out via
      // `includeArchived: true`. Defends against archived rows leaking
      // into list endpoints whose authors forgot to use `findActive()`.
      const effectiveFilters = [...filters];
      if (this.softDelete && !options.includeArchived) {
        const { field, tombstones } = this.softDelete;
        if (tombstones.length === 1) {
          effectiveFilters.push({ field, op: "!=", value: tombstones[0] });
        } else if (tombstones.length > 1) {
          effectiveFilters.push({ field, op: "not-in", value: [...tombstones] });
        }
      }

      let query: Query<DocumentData> = this.collection;

      for (const filter of effectiveFilters) {
        query = query.where(filter.field, filter.op, filter.value);
      }

      const countSnap = await query.count().get();
      trackFirestoreReads(1); // aggregate count() = 1 read
      const total = countSnap.data().count;

      query = query
        .orderBy(orderBy, orderDir)
        .offset((page - 1) * limit)
        .limit(limit);

      const snapshot = await query.get();
      trackFirestoreReads(snapshot.size);
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T);

      return {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  async findOne(filters: WhereClause[]): Promise<T | null> {
    return withSpan({ op: "db.firestore", name: `${this.resourceName}.findOne` }, async () => {
      let query: Query<DocumentData> = this.collection;
      for (const filter of filters) {
        query = query.where(filter.field, filter.op, filter.value);
      }
      const snapshot = await query.limit(1).get();
      trackFirestoreReads(snapshot.size || 1); // empty result still bills 1
      if (snapshot.empty) return null;
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() } as T;
    });
  }

  async exists(id: string): Promise<boolean> {
    return withSpan({ op: "db.firestore", name: `${this.resourceName}.exists` }, async () => {
      const doc = await this.collection.doc(id).get();
      trackFirestoreReads(1);
      return doc.exists;
    });
  }

  // ── Write ─────────────────────────────────────────────────────────────

  async create(
    data: Omit<T, "id" | "createdAt" | "updatedAt"> & Record<string, unknown>,
  ): Promise<T> {
    return withSpan({ op: "db.firestore", name: `${this.resourceName}.create` }, async () => {
      const now = new Date().toISOString();
      const docRef = this.collection.doc();
      const document = {
        ...data,
        id: docRef.id,
        createdAt: now,
        updatedAt: now,
      };
      await docRef.set(document);
      return document as unknown as T;
    });
  }

  async createWithId(
    id: string,
    data: Omit<T, "id" | "createdAt" | "updatedAt"> & Record<string, unknown>,
  ): Promise<T> {
    return withSpan({ op: "db.firestore", name: `${this.resourceName}.createWithId` }, async () => {
      const now = new Date().toISOString();
      const docRef = this.collection.doc(id);
      const document = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };
      await docRef.set(document);
      return document as unknown as T;
    });
  }

  // W10-P4 — BaseRepository.update / softDelete previously did a
  // doc.get() existence check followed by a separate docRef.update().
  // Race window: a concurrent delete between get and update would
  // produce a Firestore error rather than the intended NotFoundError.
  // Firestore's `update()` already throws `not-found` natively when
  // the doc is missing, so we drop the pre-read and translate the
  // provider error into our typed NotFoundError. Same caller-facing
  // semantics (404 → NotFoundError); one fewer read; no race window.

  async update(id: string, data: Partial<T> & Record<string, unknown>): Promise<void> {
    return withSpan({ op: "db.firestore", name: `${this.resourceName}.update` }, async () => {
      try {
        await this.collection.doc(id).update({
          ...data,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        throw translateNotFound(err, this.resourceName, id);
      }
    });
  }

  async softDelete(id: string, statusField = "status", statusValue = "archived"): Promise<void> {
    return withSpan({ op: "db.firestore", name: `${this.resourceName}.softDelete` }, async () => {
      try {
        await this.collection.doc(id).update({
          [statusField]: statusValue,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        throw translateNotFound(err, this.resourceName, id);
      }
    });
  }

  /**
   * Read-side counterpart of `softDelete()`. Wraps `findMany()` with a
   * default exclusion list so callers that "want every active record"
   * stop having to remember the soft-delete contract on every call.
   *
   * Defaults exclude `archived` AND `cancelled` because both are
   * soft-delete tombstones in the Teranga model (events are
   * `cancelled`, organizations / venues are `archived`). Pass
   * `excludeStatuses` to override per call site.
   *
   * Implements ADR-0008 §"Conventions" and removes the cite to a missing
   * helper that previously appeared in the ADR text.
   */
  async findActive(
    filters: WhereClause[] = [],
    pagination?: PaginationParams,
    options: { statusField?: string; excludeStatuses?: string[] } = {},
  ): Promise<PaginatedResult<T>> {
    const { statusField = "status", excludeStatuses = ["archived", "cancelled"] } = options;
    // Firestore `not-in` accepts up to 10 values — sufficient for the
    // current soft-delete tombstone vocabulary. Single-value form uses
    // `!=` for index-friendliness.
    const statusFilter: WhereClause =
      excludeStatuses.length === 1
        ? { field: statusField, op: "!=", value: excludeStatuses[0] }
        : { field: statusField, op: "not-in", value: excludeStatuses };
    return this.findMany([...filters, statusFilter], pagination);
  }

  async increment(id: string, field: string, amount = 1): Promise<void> {
    return withSpan({ op: "db.firestore", name: `${this.resourceName}.increment` }, async () => {
      await this.collection.doc(id).update({
        [field]: FieldValue.increment(amount),
        updatedAt: new Date().toISOString(),
      });
    });
  }

  // ── Batch ─────────────────────────────────────────────────────────────

  async batchGet(ids: string[]): Promise<T[]> {
    if (ids.length === 0) return [];

    return withSpan({ op: "db.firestore", name: `${this.resourceName}.batchGet` }, async () => {
      // Firestore getAll has a limit of 100 docs
      const results: T[] = [];
      const chunks = chunkArray(ids, 100);

      for (const chunk of chunks) {
        const refs = chunk.map((id) => this.collection.doc(id));
        const docs = await db.getAll(...refs);
        for (const doc of docs) {
          if (doc.exists) {
            results.push({ id: doc.id, ...doc.data() } as T);
          }
        }
      }

      return results;
    });
  }

  // ── Raw access (for complex queries in specific repositories) ─────────

  get ref(): CollectionReference<DocumentData> {
    return this.collection;
  }

  get firestore() {
    return db;
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Translate Firestore's "not-found" error (raised when `update()` is
 * called on a missing doc) into our typed `NotFoundError`. Other
 * provider errors propagate unchanged so callers can still handle
 * permission-denied, deadline-exceeded, etc.
 *
 * Firestore admin SDK surfaces the missing-doc condition as either:
 *   - `err.code === 5` (raw gRPC NOT_FOUND), or
 *   - `err.code === "not-found"` (Firebase JS SDK string code), or
 *   - the message contains "NOT_FOUND" / "No document to update".
 */
function translateNotFound(err: unknown, resourceName: string, id: string): unknown {
  const e = err as { code?: unknown; message?: unknown };
  const code = e?.code;
  const message = typeof e?.message === "string" ? e.message : "";
  const isNotFound =
    code === 5 ||
    code === "not-found" ||
    code === "NOT_FOUND" ||
    message.includes("NOT_FOUND") ||
    message.includes("No document to update");
  return isNotFound ? new NotFoundError(resourceName, id) : err;
}
