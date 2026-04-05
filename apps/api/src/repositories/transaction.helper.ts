import { type Transaction, FieldValue } from "firebase-admin/firestore";
import { db } from "@/config/firebase";

/**
 * Run a Firestore transaction with automatic retry (up to 5 attempts, Firestore default).
 * Wraps db.runTransaction() with structured logging on failure.
 *
 * Usage:
 *   const result = await runTransaction(async (tx) => {
 *     const doc = await tx.get(docRef);
 *     tx.update(docRef, { count: FieldValue.increment(1) });
 *     return doc.data();
 *   });
 */
export async function runTransaction<T>(
  fn: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  return db.runTransaction(fn);
}

/**
 * Re-export FieldValue for convenience in transactional operations.
 */
export { FieldValue };
