import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { type UnsubscribableCategory } from "./unsubscribe-token";

// Maps each unsubscribable EmailCategory to the preference field that
// gates it (same mapping email.service.ts uses internally — duplicated
// here so this module stays independent). Authoritative definition lives
// in email.service.ts `CATEGORY_PREF_FIELD` and must stay in sync; the
// service + this helper only cover the three non-mandatory categories
// so a type-narrowing compiler error catches divergence.
const CATEGORY_PREF_FIELD: Record<
  UnsubscribableCategory,
  "emailTransactional" | "emailOrganizational" | "emailMarketing"
> = {
  transactional: "emailTransactional",
  organizational: "emailOrganizational",
  marketing: "emailMarketing",
};

export type UnsubscribeSource = "list_unsubscribe_click" | "list_unsubscribe_post";

/**
 * Self-service unsubscribe triggered by a verified List-Unsubscribe
 * token. Flips the corresponding per-category preference to `false`,
 * preserves the rest, and emits the audit event.
 *
 * Idempotent by design — re-running on an already-disabled preference
 * is a no-op write (Firestore merge) and does NOT re-emit the audit
 * event. Matters for Gmail's RFC 8058 one-click path because mail
 * clients sometimes prefetch the POST for viewing statistics, and we
 * don't want audit-log noise from a user who hasn't actually clicked.
 */
export async function unsubscribeCategory(params: {
  userId: string;
  category: UnsubscribableCategory;
  source: UnsubscribeSource;
}): Promise<{ alreadyUnsubscribed: boolean }> {
  const field = CATEGORY_PREF_FIELD[params.category];
  const now = new Date().toISOString();
  const ref = db.collection(COLLECTIONS.NOTIFICATION_PREFERENCES).doc(params.userId);

  const alreadyUnsubscribed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    if (existing[field] === false) {
      return true;
    }

    tx.set(
      ref,
      {
        id: params.userId,
        userId: params.userId,
        [field]: false,
        updatedAt: now,
      },
      { merge: true },
    );
    return false;
  });

  if (!alreadyUnsubscribed) {
    // Self-service — actorId == the unsubscriber. No admin involvement,
    // no organization scope.
    eventBus.emit("notification.unsubscribed", {
      userId: params.userId,
      category: params.category,
      source: params.source,
      actorId: params.userId,
      requestId: getRequestId(),
      timestamp: now,
    });
  }

  return { alreadyUnsubscribed };
}
