import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";
import { type Plan } from "@teranga/shared-types";

export class PlanRepository extends BaseRepository<Plan> {
  constructor() {
    super(COLLECTIONS.PLANS, "Plan");
  }

  /**
   * Find the LATEST version of a plan by its stable `key` (e.g. "pro").
   *
   * The catalog reader is version-aware: with Phase 7, multiple plan docs
   * can share the same `key` (one per version). Only the doc flagged
   * `isLatest: true` is returned here — this is what the public catalog,
   * the billing UI, and new-subscription writes should see.
   *
   * Plans created before the Phase 7 backfill don't have `isLatest` at all;
   * in that migration window we treat "no isLatest field" as "true" so
   * the catalog keeps working.
   */
  async findByKey(key: string): Promise<Plan | null> {
    const snap = await this.collection.where("key", "==", key).get();
    if (snap.empty) return null;
    const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Plan);
    return plans.find((p) => p.isLatest !== false) ?? null;
  }

  /**
   * Return every version in a lineage, newest first. Superadmin-only UI
   * uses this to render a plan's version timeline.
   */
  async findLineage(lineageId: string): Promise<Plan[]> {
    const snap = await this.collection
      .where("lineageId", "==", lineageId)
      .orderBy("version", "desc")
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Plan);
  }

  /**
   * List plans ordered by sortOrder.
   *
   * By default only the LATEST version of each lineage is returned — the
   * public catalog and the superadmin list both want the current prices,
   * not historical drafts. Set `includeHistory: true` to include every
   * version (used by the admin version-history view once that UI ships).
   *
   * Archived plans are excluded unless `includeArchived` is true. Non-
   * public plans are excluded unless `includePrivate` is true.
   */
  async listCatalog(
    options: {
      includeArchived?: boolean;
      includePrivate?: boolean;
      includeHistory?: boolean;
    } = {},
  ): Promise<Plan[]> {
    const { includeArchived = false, includePrivate = false, includeHistory = false } = options;

    // Firestore doesn't support compound OR well with order by; simplest is
    // fetch all and filter in memory. Plan catalog is small (< 50 entries
    // realistically, even with version history).
    const snap = await this.collection.orderBy("sortOrder", "asc").get();
    const plans = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Plan);

    return plans.filter((p) => {
      if (!includeHistory && p.isLatest === false) return false;
      if (!includeArchived && p.isArchived) return false;
      if (!includePrivate && !p.isPublic) return false;
      return true;
    });
  }
}

export const planRepository = new PlanRepository();
