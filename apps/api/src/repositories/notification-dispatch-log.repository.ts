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
// redacted recipient ref, status ("sent" | "suppressed"), provider
// messageId (for cross-referencing bounces / opens / clicks), and an
// optional failure reason.
//
// Collection schema:
//   notificationDispatchLog/{id}
//     id: auto
//     key: string (catalog key, e.g. "registration.created")
//     channel: "email" | "sms" | "push" | "in_app"
//     recipientRef: string ("user:<uid>" or "email:<8ch-sha256>@<domain>")
//     status: "sent" | "suppressed"
//     reason?: suppression reason (only when status === "suppressed")
//     messageId?: string (provider id for sends)
//     idempotencyKey?: string
//     attemptedAt: ISO string (server timestamp of the dispatch)
//     requestId: string (from the AsyncLocalStorage request context)
//     actorId: string
//
// Rules: server-only. Super-admin reads drive the Phase 5 observability
// dashboard in the backoffice. The collection is declared in
// apps/api/src/config/firebase.ts → COLLECTIONS.NOTIFICATION_DISPATCH_LOG
// and gated in infrastructure/firebase/firestore.rules (deny-all).
//
// TTL: Firestore TTL policy on `attemptedAt` (90 days) will be wired in
// a follow-up Terraform change. Until then the collection grows without
// bound — admins should prune manually if volume gets large.

export interface DispatchLogEntry {
  id: string;
  key: string;
  channel: NotificationChannel;
  recipientRef: string;
  status: "sent" | "suppressed";
  reason?: NotificationSuppressionReason;
  messageId?: string;
  idempotencyKey?: string;
  attemptedAt: string;
  requestId: string;
  actorId: string;
}

export class NotificationDispatchLogRepository extends BaseRepository<DispatchLogEntry> {
  constructor() {
    super(COLLECTIONS.NOTIFICATION_DISPATCH_LOG, "NotificationDispatchLog");
  }

  /**
   * Append a new dispatch-log entry. Fire-and-forget — errors are
   * swallowed so a logging failure cannot block the request path.
   * Returns the generated id so callers can correlate in other logs.
   */
  async append(entry: Omit<DispatchLogEntry, "id">): Promise<string> {
    try {
      const docRef = this.collection.doc();
      await docRef.set({
        id: docRef.id,
        ...entry,
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
   * Per-key counts of sent / suppressed in the last N days. Called with
   * N=1 for the today widget and N=7 for the weekly summary on the
   * super-admin notifications page. Result shape is keyed by notification
   * key so the UI can render per-row rates alongside the catalog.
   *
   * Implementation: single-collection scan with a `where attemptedAt >=
   * cutoff` filter. Small write volumes (low thousands per day at our
   * scale) make a scan acceptable; migrate to a pre-aggregated
   * `notificationMetrics` collection once volume warrants.
   */
  async aggregateStats(days: number): Promise<
    Record<
      string,
      {
        sent: number;
        suppressed: number;
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
          suppressionByReason: Partial<Record<NotificationSuppressionReason, number>>;
        }
      > = {};

      for (const doc of snap.docs) {
        const data = doc.data() as DispatchLogEntry;
        if (!stats[data.key]) {
          stats[data.key] = { sent: 0, suppressed: 0, suppressionByReason: {} };
        }
        const entry = stats[data.key]!;
        if (data.status === "sent") {
          entry.sent++;
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
}

export const notificationDispatchLogRepository = new NotificationDispatchLogRepository();
