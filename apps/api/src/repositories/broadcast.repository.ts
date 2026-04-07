import { type Broadcast } from "@teranga/shared-types";
import { BaseRepository } from "./base.repository";
import { COLLECTIONS } from "@/config/firebase";

class BroadcastRepository extends BaseRepository<Broadcast> {
  constructor() {
    super(COLLECTIONS.BROADCASTS, "Broadcast");
  }

  async findByEvent(
    eventId: string,
    filters: { status?: string } = {},
    pagination: { page: number; limit: number } = { page: 1, limit: 20 },
  ): Promise<{ data: Broadcast[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    let query = this.collection.where("eventId", "==", eventId) as FirebaseFirestore.Query;

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

    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Broadcast);

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
}

export const broadcastRepository = new BroadcastRepository();
