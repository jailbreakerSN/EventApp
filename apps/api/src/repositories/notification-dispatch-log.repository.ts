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

  // ─── Phase 2.5 — delivery observability (email) ─────────────────────
  // Back-annotated by the Resend webhook. Never written on the initial
  // append — the dispatcher only knows the send was accepted by the
  // provider, not that it was delivered.
  deliveryStatus?: DispatchLogDeliveryStatus;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  bouncedAt?: string;
  complainedAt?: string;

  // ─── Phase D.2 — push delivery observability ────────────────────────
  // Back-annotated by POST /v1/notifications/:id/push-displayed and
  // .../push-clicked when the service worker reports that a background
  // FCM push was rendered or tapped. Kept orthogonal to the email
  // delivery-status lifecycle above — a push has no "delivered" vs
  // "opened" split (the browser either shows it or it never happened).
  // Rows for the `in_app` channel fill these in; rows for `email`
  // never do.
  pushDisplayedAt?: string;
  pushClickedAt?: string;

  // Firestore TTL target. 90 days for normal sends; 365 for bounced/
  // complained compliance rows. See computeDispatchLogExpiry below.
  expiresAt: string;
}

// ─── Phase D.3 — delivery dashboard aggregation contract ───────────────────
// Shape consumed by the super-admin observability dashboard. Totals mirror
// the dispatcher's outcome vocabulary (sent, delivered, opened, clicked for
// email; pushDisplayed/pushClicked for in-app + push) and the suppression
// reasons from NotificationSuppressionReasonSchema, plus `bounced` /
// `complained` back-annotated from the Resend webhook and the
// `deduplicated` status the dispatcher stamps on dedup short-circuits.
// Exported for the route layer + admin dashboard tests.
export interface DeliveryDashboardTotals {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  pushDisplayed: number;
  pushClicked: number;
  suppressed: {
    admin_disabled: number;
    user_opted_out: number;
    on_suppression_list: number;
    no_recipient: number;
    rate_limited: number;
    deduplicated: number;
    bounced: number;
    complained: number;
  };
}

export interface DeliveryDashboardBucket {
  /** ISO timestamp at the granularity boundary (hour or day). */
  bucket: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  pushDisplayed: number;
  pushClicked: number;
  suppressed: number;
}

export interface DeliveryDashboardPerChannel {
  channel: NotificationChannel;
  sent: number;
  suppressed: number;
  /** delivered|displayed / sent, 0..1. 0 when sent === 0. */
  successRate: number;
}

export interface DeliveryDashboardAggregate {
  totals: DeliveryDashboardTotals;
  timeseries: DeliveryDashboardBucket[];
  perChannel: DeliveryDashboardPerChannel[];
  /** Count of underlying dispatch-log rows scanned. Used by the route to
   *  warn when the hard cap was hit. */
  scanned: number;
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
   * Phase D.2 — push delivery back-annotation.
   *
   * When the service worker POSTs /v1/notifications/:id/push-displayed
   * or .../push-clicked, this method looks up every dispatch-log row
   * whose `messageId` equals the notification doc id (the in-app
   * adapter sets this at send time) and stamps the corresponding
   * timestamp field. Idempotent — repeated back-annotations only ever
   * stamp the same timestamp, never demote.
   *
   * Reuses the (messageId, attemptedAt) composite index already declared
   * for Phase 2.5's webhook back-annotation. Fails silently (fire-and-
   * forget) so a missing log row (older than TTL, or pre-Phase-D.1) does
   * not 500 the SW ping.
   */
  async backAnnotatePushEvent(params: {
    notificationId: string;
    kind: "displayed" | "clicked";
    occurredAt: string;
  }): Promise<{ matched: number; updated: number }> {
    const { notificationId, kind, occurredAt } = params;
    if (!notificationId) return { matched: 0, updated: 0 };
    const tsField = kind === "displayed" ? "pushDisplayedAt" : "pushClickedAt";
    try {
      const snap = await this.collection
        .where("messageId", "==", notificationId)
        .limit(10)
        .get();
      if (snap.empty) return { matched: 0, updated: 0 };

      let updated = 0;
      const batch = this.collection.firestore.batch();
      for (const doc of snap.docs) {
        const data = doc.data() as DispatchLogEntry;
        // Only stamp when the field is unset — the SW can fire the
        // same event multiple times (tab reopen, network retry) and a
        // first-displayed timestamp is more useful than a
        // last-displayed one. If you ever want "last displayed",
        // add a separate field; don't overload this one.
        if (data[tsField] != null) continue;
        batch.update(doc.ref, { [tsField]: occurredAt });
        updated++;
      }
      if (updated > 0) {
        await batch.commit();
      }
      return { matched: snap.size, updated };
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          event: "notification.dispatch_log_push_backannotate_failed",
          notificationId,
          kind,
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
      return { matched: 0, updated: 0 };
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

  /**
   * Phase D.3 — super-admin delivery dashboard aggregation.
   *
   * Scans dispatch-log rows in the `[windowStart, windowEnd]` interval
   * (window capped at 30 days at the route layer — matches the 90-day
   * TTL minus a safety margin), optionally filtered by catalog key and
   * channel, and emits three slices:
   *
   *   - totals: summed outcomes across the window
   *   - timeseries: bucketed by `hour` or `day` using UTC boundaries
   *   - perChannel: per-channel sent / suppressed / successRate
   *
   * Cost envelope: one collection-scan, ~10k row hard cap. The same
   * cap used by `aggregateDeliveryOutcomes`. The route returns `scanned`
   * so the UI can warn when the cap was hit (indicating the window
   * should be narrowed).
   *
   * Correctness notes:
   *   - Email outcomes (delivered/opened/clicked) derive from
   *     `deliveryStatus` back-annotated by the Resend webhook. A row
   *     without deliveryStatus is counted as `sent` when `status === "sent"`.
   *   - `bounced` / `complained` are counted under suppressed (they
   *     terminate the happy path), NOT under delivered/opened even if
   *     those flags were once set — the webhook back-annotation strictly
   *     promotes forward.
   *   - Push outcomes (pushDisplayed/pushClicked) are orthogonal to the
   *     email lifecycle — a single row can contribute to both `sent` and
   *     `pushDisplayed`.
   *   - `deduplicated` rows count as suppressed (no provider round-trip
   *     happened) AND increment the `deduplicated` reason bucket.
   */
  async aggregateDeliveryDashboard(params: {
    windowStart: string;
    windowEnd: string;
    granularity: "hour" | "day";
    key?: string;
    channel?: NotificationChannel;
  }): Promise<DeliveryDashboardAggregate> {
    const { windowStart, windowEnd, granularity, key, channel } = params;

    const totals: DeliveryDashboardTotals = {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      pushDisplayed: 0,
      pushClicked: 0,
      suppressed: {
        admin_disabled: 0,
        user_opted_out: 0,
        on_suppression_list: 0,
        no_recipient: 0,
        rate_limited: 0,
        deduplicated: 0,
        bounced: 0,
        complained: 0,
      },
    };

    const bucketMap = new Map<string, DeliveryDashboardBucket>();
    const perChannelMap = new Map<
      NotificationChannel,
      { sent: number; suppressed: number; deliveredOrDisplayed: number }
    >();

    let scanned = 0;
    const HARD_ROW_CAP = 10_000;

    try {
      let q = this.collection
        .where("attemptedAt", ">=", windowStart)
        .where("attemptedAt", "<=", windowEnd);
      if (key) q = q.where("key", "==", key);
      if (channel) q = q.where("channel", "==", channel);

      const snap = await q.limit(HARD_ROW_CAP).get();
      scanned = snap.size;

      for (const doc of snap.docs) {
        const data = doc.data() as DispatchLogEntry;
        const bucket = bucketKey(data.attemptedAt, granularity);

        // Initialise per-bucket record lazily so we only allocate entries
        // for time slots where activity actually happened.
        let b = bucketMap.get(bucket);
        if (!b) {
          b = {
            bucket,
            sent: 0,
            delivered: 0,
            opened: 0,
            clicked: 0,
            pushDisplayed: 0,
            pushClicked: 0,
            suppressed: 0,
          };
          bucketMap.set(bucket, b);
        }

        const ch = data.channel;
        let chRec = perChannelMap.get(ch);
        if (!chRec) {
          chRec = { sent: 0, suppressed: 0, deliveredOrDisplayed: 0 };
          perChannelMap.set(ch, chRec);
        }

        // ── Primary status classification ────────────────────────────
        if (data.status === "deduplicated") {
          // Dedup rows never hit the provider. Count them as suppressed
          // with reason=deduplicated so retry-storm audits are distinct
          // from real suppressions.
          totals.suppressed.deduplicated++;
          b.suppressed++;
          chRec.suppressed++;
        } else if (data.status === "suppressed") {
          // Map dispatcher reason → totals bucket. Webhook-originated
          // bounced/complained rows set deliveryStatus AND
          // status=suppressed — deliveryStatus wins so we double-count
          // neither.
          if (data.deliveryStatus === "bounced") {
            totals.suppressed.bounced++;
          } else if (data.deliveryStatus === "complained") {
            totals.suppressed.complained++;
          } else if (data.reason) {
            // Defensive: only increment known reason keys so a stray
            // Firestore value can't crash the aggregator.
            switch (data.reason) {
              case "admin_disabled":
              case "user_opted_out":
              case "on_suppression_list":
              case "no_recipient":
              case "bounced":
                totals.suppressed[data.reason]++;
                break;
            }
          }
          b.suppressed++;
          chRec.suppressed++;
        } else if (data.status === "sent") {
          // Email lifecycle — deliveryStatus may have been promoted by
          // the webhook. Count at the highest attained state; do NOT
          // double-count by incrementing sent+delivered+opened+clicked.
          // Rationale: funnel charts read the bucketed totals as stacked
          // values (sent - delivered = "in-flight"). If every delivered
          // row also counted as sent, "sent" would permanently include
          // everything that ever happened and the funnel collapses.
          const deliveryStatus = data.deliveryStatus;
          switch (deliveryStatus) {
            case "clicked":
              totals.clicked++;
              b.clicked++;
              chRec.deliveredOrDisplayed++;
              break;
            case "opened":
              totals.opened++;
              b.opened++;
              chRec.deliveredOrDisplayed++;
              break;
            case "delivered":
              totals.delivered++;
              b.delivered++;
              chRec.deliveredOrDisplayed++;
              break;
            case "bounced":
              // Promoted to terminal failure via webhook but status
              // may still read "sent" if the suppression-flip hasn't
              // been applied. Count as suppressed/bounced to match
              // operator intuition.
              totals.suppressed.bounced++;
              b.suppressed++;
              chRec.suppressed++;
              break;
            case "complained":
              totals.suppressed.complained++;
              b.suppressed++;
              chRec.suppressed++;
              break;
            default:
              // No webhook promotion yet — baseline sent count.
              totals.sent++;
              b.sent++;
              chRec.sent++;
              break;
          }
        }

        // ── Push lifecycle — orthogonal to email ─────────────────────
        // A row with pushDisplayedAt means the service worker reported
        // the push was rendered, regardless of where the email
        // lifecycle ended. Count it on top of the primary
        // classification so the dashboard can show email funnel AND
        // push funnel from the same scan.
        if (data.pushDisplayedAt) {
          totals.pushDisplayed++;
          b.pushDisplayed++;
          // For the per-channel success-rate denominator, every non-
          // dedup send on a push/in_app row still counts as sent — so
          // we recycle the sent counter above when status === "sent".
          chRec.deliveredOrDisplayed++;
        }
        if (data.pushClickedAt) {
          totals.pushClicked++;
          b.pushClicked++;
        }
      }
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          event: "notification.dispatch_log_delivery_dashboard_failed",
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
    }

    const timeseries = Array.from(bucketMap.values()).sort((a, b) =>
      a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0,
    );

    const perChannel: DeliveryDashboardPerChannel[] = Array.from(
      perChannelMap.entries(),
    ).map(([ch, rec]) => ({
      channel: ch,
      sent: rec.sent,
      suppressed: rec.suppressed,
      successRate: rec.sent === 0 ? 0 : rec.deliveredOrDisplayed / rec.sent,
    }));

    return { totals, timeseries, perChannel, scanned };
  }
}

export const notificationDispatchLogRepository = new NotificationDispatchLogRepository();

// ─── Time-bucket helper (Phase D.3) ────────────────────────────────────────
// Deterministic UTC boundary for the delivery-dashboard time-series. Hour
// granularity truncates to `YYYY-MM-DDTHH:00:00.000Z`; day granularity to
// `YYYY-MM-DDT00:00:00.000Z`. Both formats sort lexicographically in ISO
// order — no Date comparisons on the hot path.
export function bucketKey(attemptedAt: string, granularity: "hour" | "day"): string {
  // Defensive parse — a malformed ISO lands in the epoch bucket rather
  // than crashing the aggregator.
  const ms = Date.parse(attemptedAt);
  const anchor = Number.isFinite(ms) ? ms : 0;
  const d = new Date(anchor);
  if (granularity === "hour") {
    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours(),
        0,
        0,
        0,
      ),
    ).toISOString();
  }
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  ).toISOString();
}

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
