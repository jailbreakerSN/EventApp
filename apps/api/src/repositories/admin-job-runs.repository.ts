import { db, COLLECTIONS } from "@/config/firebase";
import { type AdminJobRun, type AdminJobRunsQuery } from "@teranga/shared-types";
import type { PaginatedResult } from "./base.repository";

/**
 * Thin Firestore accessor for the admin-jobs run log.
 *
 * Listing supports filtering by `jobKey` and `status` (one each at
 * most, composite-indexable shape). Firestore equality-then-range is
 * legal, so (jobKey eq, triggeredAt desc) and (status eq, triggeredAt
 * desc) are valid composite indexes — declared in
 * `infrastructure/firebase/firestore.indexes.json`.
 *
 * We bypass the generic BaseRepository for this collection because:
 *   - The schema includes a `never-on-read-drop-stack-in-prod` rule
 *     for `error.stack` that lives in the service layer, not the
 *     repository. The repository stays dumb.
 *   - `create()` writes `id` into the doc body as well as the doc
 *     ref id, matching the rest of the platform's serialization
 *     convention.
 */
class AdminJobRunsRepository {
  private collection() {
    return db.collection(COLLECTIONS.ADMIN_JOB_RUNS);
  }

  async create(run: AdminJobRun): Promise<AdminJobRun> {
    await this.collection().doc(run.id).set(run);
    return run;
  }

  async update(runId: string, patch: Partial<AdminJobRun>): Promise<void> {
    await this.collection().doc(runId).update(patch);
  }

  async findById(runId: string): Promise<AdminJobRun | null> {
    const snap = await this.collection().doc(runId).get();
    if (!snap.exists) return null;
    return snap.data() as AdminJobRun;
  }

  async list(query: AdminJobRunsQuery): Promise<PaginatedResult<AdminJobRun>> {
    let q: FirebaseFirestore.Query = this.collection();
    if (query.jobKey) q = q.where("jobKey", "==", query.jobKey);
    if (query.status) q = q.where("status", "==", query.status);
    q = q.orderBy("triggeredAt", "desc");

    // Total-count via a separate count() query so pagination meta is
    // honest. count() aggregations are cheap (one billable doc-read
    // per group) compared to fetching the whole collection.
    const [countSnap, pageSnap] = await Promise.all([
      q.count().get(),
      q
        .offset((query.page - 1) * query.limit)
        .limit(query.limit)
        .get(),
    ]);

    const total = countSnap.data().count;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      data: pageSnap.docs.map((d) => d.data() as AdminJobRun),
      meta: { page: query.page, limit: query.limit, total, totalPages },
    };
  }
}

export const adminJobRunsRepository = new AdminJobRunsRepository();
