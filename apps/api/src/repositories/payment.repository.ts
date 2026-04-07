import { type Payment } from "@teranga/shared-types";
import { BaseRepository } from "./base.repository";
import { COLLECTIONS } from "@/config/firebase";

class PaymentRepository extends BaseRepository<Payment> {
  constructor() {
    super(COLLECTIONS.PAYMENTS, "Payment");
  }

  /** Find payment by provider transaction ID (for webhook handling) */
  async findByProviderTransactionId(providerTxId: string): Promise<Payment | null> {
    const snap = await this.collection
      .where("providerTransactionId", "==", providerTxId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as Payment;
  }

  /** Find payment by registration ID */
  async findByRegistrationId(registrationId: string): Promise<Payment | null> {
    const snap = await this.collection
      .where("registrationId", "==", registrationId)
      .where("status", "in", ["pending", "processing", "succeeded"])
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as Payment;
  }

  /** Find all payments for an event */
  async findByEvent(
    eventId: string,
    filters: { status?: string; method?: string } = {},
    pagination: { page: number; limit: number } = { page: 1, limit: 20 },
  ): Promise<{ data: Payment[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    let query = this.collection.where("eventId", "==", eventId) as FirebaseFirestore.Query;

    if (filters.status) {
      query = query.where("status", "==", filters.status);
    }
    if (filters.method) {
      query = query.where("method", "==", filters.method);
    }

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    const offset = (pagination.page - 1) * pagination.limit;
    const snap = await query
      .orderBy("createdAt", "desc")
      .offset(offset)
      .limit(pagination.limit)
      .get();

    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Payment);

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

export const paymentRepository = new PaymentRepository();
