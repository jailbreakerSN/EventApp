import {
  NotificationSettingHistorySchema,
  type NotificationSetting,
  type NotificationSettingHistory,
} from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";

// ─── Notification Settings History Repository ──────────────────────────────
// Append-only edit history for notificationSettings. One doc per write on
// the platform or per-org settings surface — produced inside the same
// transaction as the setting upsert so the history entry and the new
// value always agree.
//
// Doc id: Firestore auto-id. Query by {key, organizationId, changedAt}
// for the admin UI history panel.
//
// TTL: retention target is 1 year on `changedAt`. Firestore TTL config is
// tracked as an infra follow-up — the collection is declared in
// COLLECTIONS so the rules file and any future TTL tooling can reference
// it by name.

export class NotificationSettingsHistoryRepository {
  private get collection() {
    return db.collection(COLLECTIONS.NOTIFICATION_SETTINGS_HISTORY);
  }

  /**
   * Append a new history entry. Returns the generated doc id so callers
   * can include it in emitted domain events.
   *
   * Call site context: always invoked from a transactional path (the PUT
   * handler wraps the upsert + history append together). We accept a
   * Firestore transaction handle when present so the two writes commit
   * atomically; when none is passed (tests, scripts) the write falls
   * through to a direct Firestore add.
   */
  async append(
    entry: Omit<NotificationSettingHistory, "id">,
    tx?: FirebaseFirestore.Transaction,
  ): Promise<string> {
    // Validate before writing — keeps malformed entries out of the audit
    // trail. Generating an id locally (doc()) rather than .add() lets us
    // both stamp it into the payload and reuse the same ref inside the
    // transaction.
    const ref = this.collection.doc();
    const payload: NotificationSettingHistory = { ...entry, id: ref.id };
    NotificationSettingHistorySchema.parse(payload);

    if (tx) {
      tx.set(ref, payload);
    } else {
      await ref.set(payload);
    }
    return ref.id;
  }

  /**
   * List the most recent history entries for a (key, organizationId) pair.
   * Ordered by changedAt DESC. Default limit 50 (roughly a year of edits
   * on a well-curated catalog). `organizationId` null = platform-wide.
   */
  async listByKey(
    key: string,
    organizationId: string | null,
    limit = 50,
  ): Promise<NotificationSettingHistory[]> {
    // Firestore `where("field", "==", null)` works for explicit null but
    // not for missing-field docs. Since we always write `organizationId`
    // (null for platform) this is fine.
    const snap = await this.collection
      .where("key", "==", key)
      .where("organizationId", "==", organizationId)
      .orderBy("changedAt", "desc")
      .limit(limit)
      .get();
    const out: NotificationSettingHistory[] = [];
    for (const doc of snap.docs) {
      const parsed = NotificationSettingHistorySchema.safeParse(doc.data());
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }
}

export const notificationSettingsHistoryRepository = new NotificationSettingsHistoryRepository();

// ─── Diff helper ───────────────────────────────────────────────────────────

/**
 * Compute the list of top-level fields that differ between two settings
 * snapshots. Used by the route handlers to populate `diff` before
 * appending a history entry. Stable field order so diff strings compare
 * equal across runs.
 */
export function computeSettingDiff(
  previous: NotificationSetting | null,
  next: NotificationSetting,
): string[] {
  const changed: string[] = [];
  if (!previous) return ["enabled", "channels", "subjectOverride"].filter((field) => {
    // On a first-time write every meaningful field is a "change" relative
    // to the catalog default. Keep the list conservative to avoid noise.
    if (field === "subjectOverride") return Boolean(next.subjectOverride);
    return true;
  });

  if (previous.enabled !== next.enabled) changed.push("enabled");
  if (!arraysEqual(previous.channels, next.channels)) changed.push("channels");
  if (!deepEqualMaybe(previous.subjectOverride, next.subjectOverride)) {
    changed.push("subjectOverride");
  }
  return changed;
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function deepEqualMaybe(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
