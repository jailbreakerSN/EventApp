import { type Transaction, FieldValue } from "firebase-admin/firestore";
import { db, COLLECTIONS } from "@/config/firebase";
import { type EffectivePlan, toStoredSnapshot } from "@/services/effective-plan";

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
export async function runTransaction<T>(fn: (transaction: Transaction) => Promise<T>): Promise<T> {
  return db.runTransaction(fn);
}

/**
 * Write the denormalized effective-plan snapshot onto an organization document
 * inside an existing transaction. Keeps effectiveLimits/effectiveFeatures in
 * sync with the subscription's plan + overrides so hot-path enforcement can
 * read them in a single synchronous doc fetch (and Firestore rules can
 * reference them without cross-doc reads of the plans catalog).
 *
 * Call after any mutation that may change the effective plan: subscription
 * create/update, plan edit (fan-out), admin override assignment.
 */
export function applyEffectivePlan(tx: Transaction, orgId: string, effective: EffectivePlan): void {
  const stored = toStoredSnapshot(effective);
  const orgRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId);
  tx.update(orgRef, {
    effectiveLimits: stored.limits,
    effectiveFeatures: stored.features,
    effectivePlanKey: stored.planKey,
    effectiveComputedAt: stored.computedAt,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Re-export FieldValue for convenience in transactional operations.
 */
export { FieldValue };
