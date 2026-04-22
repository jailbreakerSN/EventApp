import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db, COLLECTIONS } from "../utils/admin";
import { dispatchInternalChunked, type InternalDispatchRecipient } from "../utils/internal-dispatch";

// ─── Post-event feedback scheduler (Phase 2.3) ─────────────────────────────
//
// Runs every 15 minutes. For every event that ended in the last 2h–2h15m
// window, fans out the `event.feedback_requested` notification (email +
// in-app) to each checked-in registrant.
//
// Window math: `now - 2h15m <= endDate < now - 2h`. The job's cadence is
// 15 min, so consecutive runs cover non-overlapping 15-min slices. If a run
// is delayed (Cloud Scheduler retry), the dispatcher's persistent
// idempotency log catches the duplicate — each dispatch carries a
// `event-feedback/${eventId}/${userId}` key.
//
// Why only checked-in? Sending a feedback survey to a no-show is noise —
// they have no signal to share. Filter on status === "checked_in"
// (confirmed registrants who never scanned are implicitly excluded).
//
// Uses `status == "published"` for event filter because events don't
// transition to "ended" status automatically today; the endDate window
// is the source of truth. Phase 3 may introduce a batch "end event"
// status transition + denormalized `endedAt` field — when that lands,
// prefer the status-based query for index efficiency.

export const sendPostEventFollowups = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "europe-west1",
    timeZone: "Africa/Dakar",
    memory: "512MiB",
    timeoutSeconds: 180,
  },
  async () => {
    const now = Date.now();
    const windowStart = new Date(now - 2 * 60 * 60 * 1000 - 15 * 60 * 1000).toISOString();
    const windowEnd = new Date(now - 2 * 60 * 60 * 1000).toISOString();

    try {
      const eventsSnap = await db
        .collection(COLLECTIONS.EVENTS)
        .where("status", "==", "published")
        .where("endDate", ">=", windowStart)
        .where("endDate", "<", windowEnd)
        .get();

      if (eventsSnap.empty) {
        logger.info("post-event feedback: no events in window", {
          windowStart,
          windowEnd,
        });
        return;
      }

      for (const eventDoc of eventsSnap.docs) {
        const event = eventDoc.data();
        const eventId = eventDoc.id;

        try {
          // Only attendees who actually showed up get surveyed.
          const regsSnap = await db
            .collection(COLLECTIONS.REGISTRATIONS)
            .where("eventId", "==", eventId)
            .where("status", "==", "checked_in")
            .get();

          if (regsSnap.empty) continue;

          const userIds = [...new Set(regsSnap.docs.map((d) => d.data().userId as string))];
          if (userIds.length === 0) continue;

          // Fetch user docs in chunks of 100 (Firestore getAll cap is 500,
          // but 100 keeps the memory footprint predictable).
          const USER_LOOKUP_CHUNK = 100;
          const recipients: InternalDispatchRecipient[] = [];
          for (let i = 0; i < userIds.length; i += USER_LOOKUP_CHUNK) {
            const slice = userIds.slice(i, i + USER_LOOKUP_CHUNK);
            const userDocs = await db.getAll(
              ...slice.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)),
            );
            for (const u of userDocs) {
              if (!u.exists) continue;
              const data = u.data()!;
              if (!data.email) continue;
              const lang = data.preferredLanguage;
              const preferredLocale =
                lang === "en" || lang === "wo" ? (lang as "en" | "wo") : "fr";
              recipients.push({
                userId: u.id,
                email: data.email,
                preferredLocale,
              });
            }
          }

          if (recipients.length === 0) continue;

          // Per-user dispatch calls so each user picks up their own
          // dedup row (idempotencyKey keyed on userId). This keeps
          // retries convergent and lets the dispatcher's opt-out
          // check run per-recipient without the chunk-level dedup
          // collapsing distinct sends into one row.
          let sent = 0;
          let failed = 0;
          for (const r of recipients) {
            const result = await dispatchInternalChunked({
              key: "event.feedback_requested",
              recipients: [r],
              params: {
                eventTitle: event.title ?? "",
                eventEndedAt: event.endDate,
                feedbackUrl: `/events/${event.slug ?? eventId}/feedback`,
              },
              idempotencyKey: `event-feedback/${eventId}/${r.userId ?? r.email ?? "anon"}`,
            });
            sent += result.sent;
            failed += result.failed;
          }

          logger.info("post-event feedback dispatched", {
            eventId,
            recipients: recipients.length,
            sent,
            failed,
          });
        } catch (err) {
          logger.error(`post-event feedback failed for event ${eventId}`, err);
        }
      }
    } catch (err) {
      logger.error("post-event feedback: top-level failure", err);
    }
  },
);
