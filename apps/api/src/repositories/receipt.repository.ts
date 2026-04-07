import { type Receipt } from "@teranga/shared-types";
import { BaseRepository } from "./base.repository";
import { db, COLLECTIONS } from "@/config/firebase";

class ReceiptRepository extends BaseRepository<Receipt> {
  constructor() {
    super(COLLECTIONS.RECEIPTS, "Receipt");
  }

  async findByPayment(paymentId: string): Promise<Receipt | null> {
    const snap = await this.collection
      .where("paymentId", "==", paymentId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as Receipt;
  }

  async findByUser(
    userId: string,
    pagination: { page: number; limit: number } = { page: 1, limit: 20 },
  ): Promise<{ data: Receipt[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    const query = this.collection.where("userId", "==", userId);

    const countSnap = await query.count().get();
    const total = countSnap.data().count;
    const offset = (pagination.page - 1) * pagination.limit;

    const snap = await query
      .orderBy("createdAt", "desc")
      .offset(offset)
      .limit(pagination.limit)
      .get();

    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Receipt);

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

  /**
   * Generate sequential receipt number using a counter document.
   * Uses a transaction to guarantee uniqueness.
   */
  async generateReceiptNumber(): Promise<string> {
    const counterRef = db.collection("counters").doc("receipts");
    const year = new Date().getFullYear();

    const newCount = await db.runTransaction(async (tx) => {
      const counterDoc = await tx.get(counterRef);
      const current = counterDoc.exists ? (counterDoc.data()?.count as number ?? 0) : 0;
      const next = current + 1;
      tx.set(counterRef, { count: next, year });
      return next;
    });

    return `REC-${year}-${String(newCount).padStart(6, "0")}`;
  }
}

export const receiptRepository = new ReceiptRepository();
