import { type Payout } from "@teranga/shared-types";
import { BaseRepository } from "./base.repository";
import { COLLECTIONS } from "@/config/firebase";

class PayoutRepository extends BaseRepository<Payout> {
  constructor() {
    super(COLLECTIONS.PAYOUTS, "Payout");
  }

  async findByOrganization(
    organizationId: string,
    filters: { status?: string } = {},
    pagination: { page: number; limit: number } = { page: 1, limit: 20 },
  ): Promise<{ data: Payout[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    let query = this.collection.where("organizationId", "==", organizationId) as FirebaseFirestore.Query;

    if (filters.status) {
      query = query.where("status", "==", filters.status);
    }

    const countSnap = await query.count().get();
    const total = countSnap.data().count;
    const offset = (pagination.page - 1) * pagination.limit;

    const snap = await query
      .orderBy("createdAt", "desc")
      .offset(offset)
      .limit(pagination.limit)
      .get();

    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Payout);

    return {
      data,
      meta: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit),
      },
    };
  }

  async findByEvent(eventId: string): Promise<Payout[]> {
    const snap = await this.collection
      .where("eventId", "==", eventId)
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Payout);
  }
}

export const payoutRepository = new PayoutRepository();
