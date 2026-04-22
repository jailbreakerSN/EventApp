import { FieldValue } from "firebase-admin/firestore";
import {
  type NotificationChannel,
  type NotificationSuppressionReason,
} from "@teranga/shared-types";
import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";

// ─── Notification Dispatch Log Repository (Phase 5) ────────────────────────
// Append-only send log written by NotificationDispatcherService. Each doc
// captures ONE dispatched-or-suppressed send: the catalog key, channel,
// redacted recipient ref, status ("sent" | "suppressed" | "deduplicated"),
// provider messageId (for cross-referencing bounces / opens / clicks),
// and an optional failure reason.
//
// Collection schema:
//   notificationDispatchLog/{id}
//     id: auto
//     key: string (catalog key, e.g. "registration.created")
//     channel: "email" | "sms" | "push" | "in_app"
//     recipientRef: string ("user:<uid>" or "email:<8ch-sha256>@<domain>")
//     status: "sent" | "suppressed" | "deduplicated"
//     reason?: suppression reason (only when status === "suppressed")
//     messageId?: string (provider id for sends)
//     idempotencyKey: string (Phase 2.2 — required; dispatcher dedup key)
//     deduplicated?: boolean (true when status === "deduplicated")
//     attemptedAt: ISO string (server timestamp of the dispatch)
//     requestId: string (from the AsyncLocalStorage request context)
//     actorId: string
//
// Rules: server-only. Super-admin reads drive the Phase 5 observability
// dashboard in the backoffice. The collection is declared in
// apps/api/src/config/firebase.ts → COLLECTIONS.NOTIFICATION_DISPATCH_LOG
// and gated in infrastructure/firebase/firestore.rules (deny-all).
//
// TTL (Phase 2.5): every row carries an `expiresAt` ISO timestamp
// populated at append time. Firestore's native TTL policy on
// `notificationDispatchLog.expiresAt` auto-deletes rows past their
// horizon (90 days standard, 365 days for bounced/complained compliance
// rows). The policy is one-time provisioning — see
// `infrastructure/firebase/firestore.ttl.md` for the gcloud command.
//
// Required composite indexes:
//   (idempotencyKey ASC, attemptedAt DESC) — Phase 2.2 dedup lookup.
//   (messageId ASC, attemptedAt DESC)      — Phase 2.5 webhook back-
//       annotation (`findByProviderMessageId`).
// Declared in infrastructure/firebase/firestore.indexes.json.

// Phase 2.5 — delivery lifecycle statuses back-annotated from Resend
// webhooks. Ordered low→high; the webhook back-annotation enforces a
// monotonic progression so out-of-order events can't demote a later
// state. `sent` is the baseline (what the dispatcher stamps); the rest
// come from Resend event types (email.delivered, email.opened,
// email.clicked, email.bounced, email.complained).
export type DispatchLogDeliveryStatus =
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained";

/**
 * Numeric ranking used to compare two delivery statuses when the
 * webhook handler has to decide whether an incoming event promotes or
 * demotes the stored state. Higher = later in the journey.
 */
export const DELIVERY_STATUS_RANK: Record<DispatchLogDeliveryStatus, number> = {
  sent: 0,
  delivered: 1,
  opened: 2,
  clicked: 3,
  // Bounced/complained are terminal failure states. We rank them above
  // the happy path so they "win" against a stale `sent`/`delivered`
  // event, but the webhook handler flips status="suppressed" at the
  // same time so analytics still count them as failures.
  bounced: 4,
  complained: 5,
};

export interface DispatchLogEntry {
  id: string;
  key: string;
  channel: NotificationChannel;
  recipientRef: string;
  status: "sent" | "suppressed" | "deduplicated";
  reason?: NotificationSuppressionReason;
  messageId?: string;
  idempotencyKey: string;
  deduplicated?: boolean;
  attemptedAt: string;
  requestId: string;
  actorId: string;

  // ─── Phase 2.5 — delivery observability ─────────────────────────────
  // Back-annotated by the Resend webhook. Never written on the initial
  // append — the dispatcher only knows the send was accepted by the
  // provider, not that it was delivered.
  deliveryStatus?: DispatchLogDeliveryStatus;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  bouncedAt?: string;
  complainedAt?: string;

  // Firestore TTL target. 90 days for normal sends; 365 for bounced/
  // complained compliance rows. See computeDispatchLogExpiry below.
  expiresAt: string;
}

export class NotificationDispatchLogRepository extends BaseRepository<DispatchLogEntry> {
  constructor() {
    super(COLLECTIONS.NOTIFICATION_DISPATCH_LOG, "NotificationDispatchLog");
  }

  /**
   * Append a new dispatch-log entry. Fire-and-forget — errors are
   * swallowed so a logging failure cannot block the request path.
   * Returns the generated id so callers can correlate in other logs.
   *
   * Phase 2.5: `expiresAt` is auto-computed from `attemptedAt` when the
   * caller omits it. 90 d for standard rows, 365 d for
   * bounced/complained compliance rows.
   */
  async append(
    entry: Omit<DispatchLogEntry, "id" | "expiresAt"> & { expiresAt?: string },
  ): Promise<string> {
    try {
      const docRef = this.collection.doc();
      const expiresAt = entry.expiresAt ?? computeDispatchLogExpiry(entry);
      await docRef.set({
        id: docRef.id,
        ...entry,
        expiresAt,
        // Use a server-side timestamp in addition to the ISO string
        // for indexing; Firestore's TTL policy will target this field.
        _serverTimestamp: FieldValue.serverTimestamp(),
      });
      return docRef.id;
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: "notification.dispatch_log_write_failed",
          key: entry.key,
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
      return "";
    }
  }

  /**
   * Aggregate stats for the admin dashboard (Phase 5 UI).
   *
   * Per-key counts of sent / suppressed / deduplicated in the last N
   * days. Called with N=1 for the today widget and N=7 for the weekly
   * summary on the super-admin notifications page. Result shape is
   * keyed by notification key so the UI can render per-row rates
   * alongside the catalog.
   *
   * Implementation: single-collection scan with a `where attemptedAt >=
   * cutoff` filter. Small write volumes (low thousands per day at our
   * scale) make a scan acceptable; migrate to a pre-aggregated
   * `notificationMetrics` collection once volume warrants.
   *
   * `deduplicated` (Phase 2.2) counts are separate from `sent` — a dup
   * that was short-circuited never hit the provider, so rolling it in
   * with `sent` would inflate delivery metrics. Admins see both counts
   * so they can quickly spot retry storms / buggy listeners.
   */
  async aggregateStats(days: number): Promise<
    Record<
      string,
      {
        sent: number;
        suppressed: number;
        deduplicated: number;
        suppressionByReason: Partial<Record<NotificationSuppressionReason, number>>;
      }
    >
  > {
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      // Hard row cap to bound admin-panel reads. 50k rows ≈ 150MB and
      // half-a-second of parse time — well under the 60s Cloud Run
      // timeout. Once volume grows past this threshold, migrate to the
      // pre-aggregated `notificationMetrics` collection planned for
      // Phase 5c (Terraform-provisioned Firestore TTL + daily summary
      // doc). Addresses Phase 5 security review P1-1.
      const HARD_ROW_CAP = 50_000;
      const snap = await this.collection
        .where("attemptedAt", ">=", cutoff)
        .limit(HARD_ROW_CAP)
        .get();
      if (snap.size >= HARD_ROW_CAP) {
        process.stderr.write(
          JSON.stringify({
            level: "warn",
            event: "notification.dispatch_log_aggregate_capped",
            days,
            cap: HARD_ROW_CAP,
          }) + "\n",
        );
      }

      const stats: Record<
        string,
        {
          sent: number;
          suppressed: number;
          deduplicated: number;
          suppressionByReason: Partial<Record<NotificationSuppressionReason, number>>;
        }
      > = {};

      for (const doc of snap.docs) {
        const data = doc.data() as DispatchLogEntry;
        if (!stats[data.key]) {
          stats[data.key] = {
            sent: 0,
            suppressed: 0,
            deduplicated: 0,
            suppressionByReason: {},
          };
        }
        const entry = stats[data.key]!;
        if (data.status === "sent") {
          entry.sent++;
        } else if (data.status === "deduplicated") {
          entry.deduplicated++;
        } else {
          entry.suppressed++;
          if (data.reason) {
            entry.suppressionByReason[data.reason] =
              (entry.suppressionByReason[data.reason] ?? 0) + 1;
          }
        }
      }

      return stats;
    } catch {
      return {};
    }
  }

  /**
   * Lookup the most recent "sent" or admin/user-suppressed entry for a
   * given idempotency key within `withinMs`. Used by the dispatcher to
   * dedup duplicate emits (retried listener, pubsub redelivery, buggy
   * caller) BEFORE hitting the provider — Resend's own idempotency
   * would catch the collision, but only after an HTTP round-trip and
   * without surfacing the dup to our admin stats.
   *
   * A "suppressed" entry with reason `admin_disabled` or `user_opted_out`
   * also counts as a terminal decision — no point replaying the same
   * decision on a retry. Other suppression reasons (`bounced`,
   * `on_suppression_list`, `no_recipient`) are transient-ish and we
   * allow the retry to re-evaluate.
   *
   * Fire-and-forget — a read failure (missing index, transient
   * Firestore error) returns null so the send proceeds rather than
   * silently dropping mail. "Fail open" matches isSuppressed + opt-out
   * behavior elsewhere in the email stack.
   *
   * Requires composite index: (idempotencyKey ASC, attemptedAt DESC)
   * — declared in infrastructure/firebase/firestore.indexes.json.
   */
  async findRecentByIdempotencyKey(
    idempotencyKey: string,
    withinMs: number,
  ): Promise<DispatchLogEntry | null> {
    try {
      const cutoff = new Date(Date.now() - withinMs).toISOString();
      const snap = await this.collection
        .where("idempotencyKey", "==", idempotencyKey)
        .where("attemptedAt", ">=", cutoff)
        .orderBy("attemptedAt", "desc")
        .limit(1)
        .get();
      if (snap.empty) return null;
      const data = snap.docs[0]!.data() as DispatchLogEntry;
      // Only terminal decisions count as dedup triggers. A previous
      // `bounced` / `no_recipient` entry does NOT suppress a retry —
      // the address may have been corrected, the recipient list
      // refilled, etc.
      if (
        data.status === "sent" ||
        data.status === "deduplicated" ||
        (data.status === "suppressed" &&
          (data.reason === "admin_disabled" || data.reason === "user_opted_out"))
      ) {
        return data;
      }
      return null;
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          event: "notification.dedup_lookup_failed",
          idempotencyKey,
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
      return null;
    }
  }

  /**
   * Phase 2.5 — webhook back-annotation lookup.
   *
   * Finds dispatch-log rows carrying the Resend `email_id`. Used by the
   * webhook handler to back-annotate deliveryStatus / per-event
   * timestamps. Requires the composite index
   * `(messageId ASC, attemptedAt DESC)` declared in
   * infrastructure/firebase/firestore.indexes.json. The index is named
   * by the conceptual alias `providerMessageId` but points at the
   * existing `messageId` field for backward compat.
   */
  async findByProviderMessageId(
    messageId: string,
    limit = 10,
  ): Promise<DispatchLogEntry[]> {
    if (!messageId) return [];
    try {
      const snap = await this.collection
        .where("messageId", "==", messageId)
        .orderBy("attemptedAt", "desc")
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.data() as DispatchLogEntry);
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          event: "notification.dispatch_log_lookup_failed",
          messageId,
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
      return [];
    }
  }

  /**
   * Phase 2.5 — user communication history.
   *
   * Returns the rows addressed to a specific user, most-recent first,
   * capped at 90 days. Powers `GET /v1/me/notifications/history` + the
   * backoffice UI. We surface suppressed / deduplicated / delivery-
   * failed rows too so users can see why an email never landed.
   */
  async listRecentForUser(params: {
    userId: string;
    limit?: number;
    cursorAttemptedAt?: string;
  }): Promise<DispatchLogEntry[]> {
    const { userId, limit = 50, cursorAttemptedAt } = params;
    if (!userId) return [];
    try {
      const recipientRef = `user:${userId}`;
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      let q = this.collection
        .where("recipientRef", "==", recipientRef)
        .where("attemptedAt", ">=", cutoff)
        .orderBy("attemptedAt", "desc");
      if (cursorAttemptedAt) {
        q = q.startAfter(cursorAttemptedAt);
      }
      const snap = await q.limit(Math.min(limit, 100)).get();
      return snap.docs.map((d) => d.data() as DispatchLogEntry);
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          event: "notification.dispatch_log_user_list_failed",
          userId,
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
      return [];
    }
  }

  /**
   * Phase 2.5 — per-window delivery outcome aggregation for the
   * bounce-rate health monitor. Scopes to a key set (e.g. every key
   * routed through the billing@ mailbox) so alerts are domain-specific.
   */
  async aggregateDeliveryOutcomes(params: {
    windowStart: string;
    windowEnd: string;
    keys?: readonly string[];
  }): Promise<{
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    suppressed: number;
    total: number;
  }> {
    const tallies = {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
      suppressed: 0,
      total: 0,
    };
    try {
      let q = this.collection
        .where("attemptedAt", ">=", params.windowStart)
        .where("attemptedAt", "<=", params.windowEnd);
      if (params.keys && params.keys.length > 0 && params.keys.length <= 10) {
        q = q.where("key", "in", [...params.keys]);
      }
      const snap = await q.limit(10_000).get();
      for (const doc of snap.docs) {
        const data = doc.data() as DispatchLogEntry;
        tallies.total++;
        if (data.status === "suppressed") tallies.suppressed++;
        switch (data.deliveryStatus) {
          case "delivered":
            tallies.delivered++;
            break;
          case "opened":
            tallies.opened++;
            break;
          case "clicked":
            tallies.clicked++;
            break;
          case "bounced":
            tallies.bounced++;
            break;
          case "complained":
            tallies.complained++;
            break;
          default:
            if (data.status === "sent") tallies.sent++;
        }
      }
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          event: "notification.dispatch_log_delivery_aggregation_failed",
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
    }
    return tallies;
  }
}

export const notificationDispatchLogRepository = new NotificationDispatchLogRepository();

// ─── TTL helper ─────────────────────────────────────────────────────────────
// Compliance rows (bounced / complained) live for 365 days; everything
// else lives for 90. Exported for tests + the webhook back-annotation.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STANDARD_TTL_DAYS = 90;
const COMPLIANCE_TTL_DAYS = 365;

export function computeDispatchLogExpiry(
  entry: Pick<DispatchLogEntry, "attemptedAt" | "status" | "reason" | "deliveryStatus">,
): string {
  const base = Date.parse(entry.attemptedAt);
  const anchor = Number.isFinite(base) ? base : Date.now();
  const isComplianceRow =
    entry.deliveryStatus === "bounced" ||
    entry.deliveryStatus === "complained" ||
    entry.reason === "bounced" ||
    entry.reason === "on_suppression_list";
  const days = isComplianceRow ? COMPLIANCE_TTL_DAYS : STANDARD_TTL_DAYS;
  return new Date(anchor + days * MS_PER_DAY).toISOString();
}
