import { type SponsorLead } from "@teranga/shared-types";
import { BaseRepository } from "./base.repository";
import { COLLECTIONS } from "@/config/firebase";

class SponsorLeadRepository extends BaseRepository<SponsorLead> {
  constructor() {
    super(COLLECTIONS.SPONSOR_LEADS, "SponsorLead");
  }

  async findBySponsor(
    sponsorId: string,
    pagination: { page: number; limit: number } = { page: 1, limit: 50 },
  ): Promise<{ data: SponsorLead[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    const query = this.collection.where("sponsorId", "==", sponsorId);
    const countSnap = await query.count().get();
    const total = countSnap.data().count;
    const offset = (pagination.page - 1) * pagination.limit;

    const snap = await query
      .orderBy("scannedAt", "desc")
      .offset(offset)
      .limit(pagination.limit)
      .get();

    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SponsorLead);
    return {
      data,
      meta: { total, page: pagination.page, limit: pagination.limit, totalPages: Math.ceil(total / pagination.limit) },
    };
  }

  async findByParticipant(sponsorId: string, participantId: string): Promise<SponsorLead | null> {
    const snap = await this.collection
      .where("sponsorId", "==", sponsorId)
      .where("participantId", "==", participantId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as SponsorLead;
  }
}

export const sponsorLeadRepository = new SponsorLeadRepository();
