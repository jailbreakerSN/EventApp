import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";
import { type Plan } from "@teranga/shared-types";

export class PlanRepository extends BaseRepository<Plan> {
  constructor() {
    super(COLLECTIONS.PLANS, "Plan");
  }

  async findByKey(key: string): Promise<Plan | null> {
    return this.findOne([{ field: "key", op: "==", value: key }]);
  }

  /**
   * List all plans ordered by sortOrder. Archived plans are excluded unless
   * `includeArchived` is true. Non-public plans are excluded unless
   * `includePrivate` is true.
   */
  async listCatalog(
    options: {
      includeArchived?: boolean;
      includePrivate?: boolean;
    } = {},
  ): Promise<Plan[]> {
    const { includeArchived = false, includePrivate = false } = options;

    // Firestore doesn't support compound OR well with order by; simplest is
    // fetch all and filter in memory. Plan catalog is small (< 50 entries
    // realistically).
    const snap = await this.collection.orderBy("sortOrder", "asc").get();
    const plans = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Plan);

    return plans.filter((p) => {
      if (!includeArchived && p.isArchived) return false;
      if (!includePrivate && !p.isPublic) return false;
      return true;
    });
  }
}

export const planRepository = new PlanRepository();
