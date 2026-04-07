import { type SpeakerProfile } from "@teranga/shared-types";
import { BaseRepository } from "./base.repository";
import { COLLECTIONS } from "@/config/firebase";

class SpeakerRepository extends BaseRepository<SpeakerProfile> {
  constructor() {
    super(COLLECTIONS.SPEAKERS, "Speaker");
  }

  async findByEvent(
    eventId: string,
    pagination: { page: number; limit: number } = { page: 1, limit: 50 },
  ): Promise<{ data: SpeakerProfile[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    const query = this.collection.where("eventId", "==", eventId);
    const countSnap = await query.count().get();
    const total = countSnap.data().count;
    const offset = (pagination.page - 1) * pagination.limit;

    const snap = await query
      .orderBy("name", "asc")
      .offset(offset)
      .limit(pagination.limit)
      .get();

    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SpeakerProfile);
    return {
      data,
      meta: { total, page: pagination.page, limit: pagination.limit, totalPages: Math.ceil(total / pagination.limit) },
    };
  }

  async findByUser(userId: string, eventId: string): Promise<SpeakerProfile | null> {
    const snap = await this.collection
      .where("userId", "==", userId)
      .where("eventId", "==", eventId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as SpeakerProfile;
  }
}

export const speakerRepository = new SpeakerRepository();
