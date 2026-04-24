import { db, COLLECTIONS } from "@/config/firebase";
import type {
  AdminWebhookEventsQuery,
  WebhookEventLog,
  WebhookProvider,
} from "@teranga/shared-types";
import type { PaginatedResult } from "./base.repository";

/**
 * Thin Firestore accessor for the webhook events log.
 *
 * Doc-id strategy is externalised as a pure helper so the service layer
 * and any future emulator-backed tests agree on the composite key.
 */

/**
 * Compose the idempotent doc id for a (provider, transactionId, status)
 * triple. Three separators so providers that happen to use `__` in
 * their transaction ids don't collide.
 *
 * The shape is encoded so Firestore document-id constraints (no `/`,
 * no `.`, ≤ 1500 bytes) never fire in practice:
 *   - provider is a narrow enum (wave / orange_money / free_money / mock)
 *   - providerTransactionId is upstream-generated, UUID-like
 *   - status is "succeeded" | "failed"
 */
export function webhookEventDocId(
  provider: WebhookProvider,
  providerTransactionId: string,
  providerStatus: "succeeded" | "failed",
): string {
  // Firestore doc ids can't contain `/`. Every supported provider uses
  // URL-safe tx ids today; we strip `/` defensively in case a provider
  // ever ships one — `_` is a safe fallback that preserves
  // readability.
  const safeTxId = providerTransactionId.replace(/\//g, "_");
  return `${provider}__${safeTxId}__${providerStatus}`;
}

class WebhookEventsRepository {
  private collection() {
    return db.collection(COLLECTIONS.WEBHOOK_EVENTS);
  }

  async findById(id: string): Promise<WebhookEventLog | null> {
    const snap = await this.collection().doc(id).get();
    if (!snap.exists) return null;
    return snap.data() as WebhookEventLog;
  }

  /** Idempotent upsert — write the row if absent, no-op if present. */
  async upsert(event: WebhookEventLog): Promise<void> {
    await this.collection().doc(event.id).set(event, { merge: true });
  }

  async update(id: string, patch: Partial<WebhookEventLog>): Promise<void> {
    await this.collection().doc(id).update(patch);
  }

  async list(query: AdminWebhookEventsQuery): Promise<PaginatedResult<WebhookEventLog>> {
    let q: FirebaseFirestore.Query = this.collection();
    if (query.provider) q = q.where("provider", "==", query.provider);
    if (query.processingStatus) q = q.where("processingStatus", "==", query.processingStatus);
    if (query.providerStatus) q = q.where("providerStatus", "==", query.providerStatus);
    if (query.since) q = q.where("firstReceivedAt", ">=", query.since);
    q = q.orderBy("firstReceivedAt", "desc");

    // count() query in parallel with the page fetch — same pattern as
    // adminJobRunsRepository. One billable doc read per group, so
    // cheap even for 10k-row collections.
    const [countSnap, pageSnap] = await Promise.all([
      q.count().get(),
      q
        .offset((query.page - 1) * query.limit)
        .limit(query.limit)
        .get(),
    ]);

    const total = countSnap.data().count;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      data: pageSnap.docs.map((d) => d.data() as WebhookEventLog),
      meta: { page: query.page, limit: query.limit, total, totalPages },
    };
  }
}

export const webhookEventsRepository = new WebhookEventsRepository();
