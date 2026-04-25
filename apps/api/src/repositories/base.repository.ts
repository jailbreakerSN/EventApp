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

// ─── Types ────────────────────────────────────────────────────────────────────

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

export class BaseRepository<T extends { id: string }> {
  protected collection: CollectionReference<DocumentData>;
  protected resourceName: string;

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
    const doc = await this.collection.doc(id).get();
    trackFirestoreReads(1);
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as T;
  }

  async findByIdOrThrow(id: string): Promise<T> {
    const entity = await this.findById(id);
    if (!entity) throw new NotFoundError(this.resourceName, id);
    return entity;
  }

  async findMany(
    filters: WhereClause[] = [],
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<T>> {
    const { page = 1, limit = 20, orderBy = "createdAt", orderDir = "desc" } = pagination ?? {};

    let query: Query<DocumentData> = this.collection;

    // Apply where filters
    for (const filter of filters) {
      query = query.where(filter.field, filter.op, filter.value);
    }

    // Count total (for pagination meta)
    const countSnap = await query.count().get();
    trackFirestoreReads(1); // aggregate count() = 1 read
    const total = countSnap.data().count;

    // Apply ordering and pagination
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
  }

  async findOne(filters: WhereClause[]): Promise<T | null> {
    let query: Query<DocumentData> = this.collection;
    for (const filter of filters) {
      query = query.where(filter.field, filter.op, filter.value);
    }
    const snapshot = await query.limit(1).get();
    trackFirestoreReads(snapshot.size || 1); // empty result still bills 1
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as T;
  }

  async exists(id: string): Promise<boolean> {
    const doc = await this.collection.doc(id).get();
    trackFirestoreReads(1);
    return doc.exists;
  }

  // ── Write ─────────────────────────────────────────────────────────────

  async create(
    data: Omit<T, "id" | "createdAt" | "updatedAt"> & Record<string, unknown>,
  ): Promise<T> {
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
  }

  async createWithId(
    id: string,
    data: Omit<T, "id" | "createdAt" | "updatedAt"> & Record<string, unknown>,
  ): Promise<T> {
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
  }

  async update(id: string, data: Partial<T> & Record<string, unknown>): Promise<void> {
    const docRef = this.collection.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) throw new NotFoundError(this.resourceName, id);

    await docRef.update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
  }

  async softDelete(id: string, statusField = "status", statusValue = "archived"): Promise<void> {
    const docRef = this.collection.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) throw new NotFoundError(this.resourceName, id);

    await docRef.update({
      [statusField]: statusValue,
      updatedAt: new Date().toISOString(),
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
    await this.collection.doc(id).update({
      [field]: FieldValue.increment(amount),
      updatedAt: new Date().toISOString(),
    });
  }

  // ── Batch ─────────────────────────────────────────────────────────────

  async batchGet(ids: string[]): Promise<T[]> {
    if (ids.length === 0) return [];

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
