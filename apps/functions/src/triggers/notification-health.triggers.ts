import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db, COLLECTIONS } from "../utils/admin";

// ─── Notification Health Monitor (Phase 2.5) ─────────────────────────────
// Scheduled 10-minute job that aggregates the last hour of
// notificationDispatchLog rows by sending domain and raises alerts when
// the bounce rate crosses platform thresholds.
//
// Thresholds are deliberately conservative: anything sustained above 2%
// jeopardises Gmail/Yahoo sender reputation, and >5% risks an outright
// suspension. See Gmail's 2024 bulk sender rules + Resend's deliverability
// guide for the numbers.
//
// Alerts land in two places so operators can observe both via Firestore
// dashboards and Cloud Monitoring log-based policies:
//   1. `alerts/{docId}` — durable document so the admin UI has a history.
//   2. Cloud Logging at ERROR severity with a stable event name
//      `notification.bounce_rate_alert` so log-based metric + Alerting
//      Policy templates (documented in docs/notifications/alerting.md)
//      can match without extra setup.

const THRESHOLD_WARN = 0.02;
const THRESHOLD_CRITICAL = 0.05;
const WINDOW_MINUTES = 60;

// Sending-domain → catalog-key set. Keys map through the sender registry
// in apps/api/src/services/email/sender.registry.ts. Cloud Functions
// can't import the API layer directly (bundled independently), so the
// mapping is duplicated here and a unit-scale drift is acceptable.
// Order matches the RESEND_FROM_* env vars.
const DOMAIN_TO_KEYS: Record<string, readonly string[]> = {
  // events@ — transactional + auth category sends
  events: [
    "auth.email_verification",
    "auth.password_reset",
    "registration.created",
    "registration.approved",
    "registration.cancelled",
    "badge.ready",
    "event.cancelled",
    "event.reminder",
    "event.rescheduled",
    "waitlist.promoted",
    "newsletter.confirm",
    "user.password_changed",
    "user.email_changed",
    "event.feedback_requested",
  ],
  // hello@ — organizational sends
  hello: [
    "invite.sent",
    "member.added",
    "member.removed",
    "member.role_changed",
    "speaker.added",
    "sponsor.added",
    "certificate.ready",
    "subscription.approaching_limit",
  ],
  // billing@ — billing category sends
  billing: [
    "payment.succeeded",
    "payment.failed",
    "refund.issued",
    "refund.failed",
    "subscription.past_due",
    "subscription.upgraded",
    "subscription.downgraded",
    "subscription.cancelled",
    "subscription.expiring_soon",
    "payout.created",
  ],
  // news@ — marketing category sends
  news: ["newsletter.welcome", "welcome"],
};

export const monitorBounceRate = onSchedule(
  {
    // Every 10 minutes — matches Resend's webhook retry schedule so a
    // transient outage can't produce a false-positive alert while events
    // are still catching up.
    schedule: "every 10 minutes",
    region: "europe-west1",
    timeZone: "Africa/Dakar",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - WINDOW_MINUTES * 60 * 1000);

    for (const [domain, keys] of Object.entries(DOMAIN_TO_KEYS)) {
      try {
        const tallies = await aggregate(domain, keys, windowStart, windowEnd);
        const denom =
          tallies.sent + tallies.delivered + tallies.bounced + tallies.complained;
        if (denom === 0) {
          // Nothing to measure. Common in dev / off-hours — don't alert.
          continue;
        }
        const bouncedLike = tallies.bounced + tallies.complained;
        const rate = bouncedLike / denom;

        let severity: "warn" | "critical" | null = null;
        if (rate >= THRESHOLD_CRITICAL) severity = "critical";
        else if (rate >= THRESHOLD_WARN) severity = "warn";

        if (severity) {
          await writeAlert({
            domain,
            rate,
            bounceCount: bouncedLike,
            totalCount: denom,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            severity,
          });
          // Also emit to Cloud Logging at ERROR so operators can match on
          // a log-based Alerting Policy without polling Firestore.
          logger.error("notification.bounce_rate_alert", {
            domain,
            rate,
            severity,
            bounceCount: bouncedLike,
            totalCount: denom,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
          });
        }
      } catch (err) {
        // Per-domain isolation — a single domain's Firestore hiccup must
        // not prevent the rest from being checked.
        logger.error("notification.bounce_rate_monitor_failed", {
          domain,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);

interface DomainTallies {
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
}

async function aggregate(
  _domain: string,
  keys: readonly string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<DomainTallies> {
  // Firestore `in` caps at 10 — chunk and sum.
  const tallies: DomainTallies = { sent: 0, delivered: 0, bounced: 0, complained: 0 };
  for (const chunk of chunkKeys(keys, 10)) {
    if (chunk.length === 0) continue;
    const snap = await db
      .collection(COLLECTIONS.NOTIFICATION_DISPATCH_LOG)
      .where("attemptedAt", ">=", windowStart.toISOString())
      .where("attemptedAt", "<=", windowEnd.toISOString())
      .where("key", "in", [...chunk])
      .limit(5_000)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const deliveryStatus = typeof data.deliveryStatus === "string"
        ? (data.deliveryStatus as string)
        : null;
      if (deliveryStatus === "bounced") {
        tallies.bounced++;
      } else if (deliveryStatus === "complained") {
        tallies.complained++;
      } else if (deliveryStatus === "delivered" || deliveryStatus === "opened" || deliveryStatus === "clicked") {
        tallies.delivered++;
      } else if (data.status === "sent") {
        tallies.sent++;
      }
    }
  }
  return tallies;
}

function chunkKeys<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size) as T[]);
  }
  return out;
}

async function writeAlert(alert: {
  domain: string;
  rate: number;
  bounceCount: number;
  totalCount: number;
  windowStart: string;
  windowEnd: string;
  severity: "warn" | "critical";
}): Promise<void> {
  const id = `${alert.domain}-${alert.windowEnd.replace(/[:.]/g, "-")}`;
  await db
    .collection("alerts")
    .doc("notification-bounce-rate")
    .collection("events")
    .doc(id)
    .set({
      id,
      ...alert,
      createdAt: new Date().toISOString(),
    });
}
