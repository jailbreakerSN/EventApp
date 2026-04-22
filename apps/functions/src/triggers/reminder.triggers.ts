import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db, messaging, COLLECTIONS } from "../utils/admin";
import { dispatchInternalChunked, type InternalDispatchRecipient } from "../utils/internal-dispatch";

/**
 * Scheduled event reminder function.
 * Runs every 15 minutes. Sends reminders:
 * - 24 hours before the event starts
 * - 1 hour before the event starts
 *
 * Deduplication: checks for existing reminder notifications to avoid re-sending.
 */
export const sendEventReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "europe-west1",
    timeZone: "Africa/Dakar",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const now = Date.now();
    const WINDOW_MS = 15 * 60 * 1000; // 15 minute window

    // ── 24h reminders ──
    const target24h = now + 24 * 60 * 60 * 1000;
    const from24h = new Date(target24h - WINDOW_MS).toISOString();
    const to24h = new Date(target24h + WINDOW_MS).toISOString();

    await sendReminders(from24h, to24h, "24h", "demain");

    // ── 1h reminders ──
    const target1h = now + 60 * 60 * 1000;
    const from1h = new Date(target1h - WINDOW_MS).toISOString();
    const to1h = new Date(target1h + WINDOW_MS).toISOString();

    await sendReminders(from1h, to1h, "1h", "dans 1 heure");
  },
);

async function sendReminders(
  fromDate: string,
  toDate: string,
  reminderType: string,
  timeLabel: string,
): Promise<void> {
  // Find published events starting in the time window
  const eventsSnap = await db
    .collection(COLLECTIONS.EVENTS)
    .where("status", "==", "published")
    .where("startDate", ">=", fromDate)
    .where("startDate", "<=", toDate)
    .get();

  if (eventsSnap.empty) return;

  for (const eventDoc of eventsSnap.docs) {
    const event = eventDoc.data();
    const eventId = eventDoc.id;
    const eventTitle = event.title ?? "l'événement";

    try {
      // Get confirmed registrations
      const regsSnap = await db
        .collection(COLLECTIONS.REGISTRATIONS)
        .where("eventId", "==", eventId)
        .where("status", "in", ["confirmed", "checked_in"])
        .get();

      if (regsSnap.empty) continue;

      const userIds = [...new Set(regsSnap.docs.map((d) => d.data().userId))];

      // Deduplication: check which users already received this reminder
      const reminderKey = `event_reminder_${reminderType}`;
      const existingReminders = await db
        .collection(COLLECTIONS.NOTIFICATIONS)
        .where("type", "==", reminderKey)
        .where("data.eventId", "==", eventId)
        .select("userId")
        .get();

      const alreadyNotified = new Set(existingReminders.docs.map((d) => d.data().userId));
      const usersToNotify = userIds.filter((uid) => !alreadyNotified.has(uid));

      if (usersToNotify.length === 0) continue;

      // Create in-app notifications in batches
      const notifBatches = chunkArray(usersToNotify, 490);
      for (const batch of notifBatches) {
        const writeBatch = db.batch();
        const nowIso = new Date().toISOString();

        for (const userId of batch) {
          // Deterministic ID: one reminder of this kind per user per
          // event. Scheduled-function retries (Firebase Functions
          // default at-least-once) converge on the same doc instead
          // of spamming the user with duplicate 24h / 1h reminders.
          const ref = db
            .collection(COLLECTIONS.NOTIFICATIONS)
            .doc(`reminder_${reminderKey}_${eventId}_${userId}`);
          writeBatch.set(ref, {
            userId,
            type: reminderKey,
            title: `Rappel : ${eventTitle}`,
            body: `${eventTitle} commence ${timeLabel} ! Préparez votre badge QR.`,
            data: { eventId },
            imageURL: event.coverImageURL ?? null,
            isRead: false,
            readAt: null,
            createdAt: nowIso,
          });
        }

        await writeBatch.commit();
      }

      // Send push notifications
      const allTokens: string[] = [];
      const userBatches = chunkArray(usersToNotify, 100);
      for (const batch of userBatches) {
        const userDocs = await db.getAll(
          ...batch.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)),
        );
        for (const u of userDocs) {
          if (u.exists) {
            const tokens: string[] = u.data()!.fcmTokens ?? [];
            allTokens.push(...tokens);
          }
        }
      }

      if (allTokens.length > 0) {
        const tokenChunks = chunkArray(allTokens, 500);
        await Promise.allSettled(
          tokenChunks.map((chunk) =>
            messaging.sendEachForMulticast({
              tokens: chunk,
              notification: {
                title: `Rappel : ${eventTitle}`,
                body: `L'événement commence ${timeLabel} !`,
              },
              data: {
                type: "event_reminder",
                eventId,
                reminderType,
              },
              android: { priority: "high" },
              apns: { payload: { aps: { sound: "default" } } },
            }),
          ),
        );
      }

      // ── Email channel via the dispatcher (Phase 2.3) ────────────────
      // In addition to the in-app + FCM fan-out above, hand off the
      // `event.reminder` catalog key to the API's internal dispatch
      // endpoint so the branded email template ships too. The dispatcher
      // owns admin kill-switches, user opt-out, and audit logging — we
      // intentionally DO NOT duplicate the email adapter here.
      //
      // Recipients are fetched user-by-user via getAll so we can surface
      // the preferred locale; the API would otherwise default every
      // recipient to fr via the `self` resolver.
      try {
        const recipientDocs = await db.getAll(
          ...usersToNotify.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)),
        );
        const emailRecipients: InternalDispatchRecipient[] = [];
        for (const doc of recipientDocs) {
          if (!doc.exists) continue;
          const data = doc.data()!;
          if (!data.email) continue;
          const lang = data.preferredLanguage;
          const preferredLocale =
            lang === "en" || lang === "wo" ? (lang as "en" | "wo") : "fr";
          emailRecipients.push({
            userId: doc.id,
            email: data.email,
            preferredLocale,
          });
        }

        if (emailRecipients.length > 0) {
          const summary = await dispatchInternalChunked({
            key: "event.reminder",
            recipients: emailRecipients,
            params: {
              eventTitle,
              eventDate: event.startDate,
              eventLocation: event.location ?? "",
              timeUntil: timeLabel,
              badgeUrl: `/events/${event.slug ?? eventId}/badge`,
            },
            // Deterministic per user+event+variant so retries (cron at-
            // least-once) converge into the same dispatch-log row and
            // the dispatcher's persistent idempotency check short-
            // circuits the dup before re-hitting Resend.
            idempotencyKey: `event_reminder_${reminderType}_${eventId}`,
          });
          logger.info("event.reminder email dispatched", {
            eventId,
            variant: reminderType,
            recipients: emailRecipients.length,
            sent: summary.sent,
            failed: summary.failed,
          });
        }
      } catch (emailErr) {
        // Fire-and-forget — email failure never blocks in-app/FCM delivery.
        logger.error("event.reminder email dispatch failed", {
          eventId,
          err: emailErr instanceof Error ? emailErr.message : String(emailErr),
        });
      }

      logger.info(`${reminderType} reminder sent`, {
        eventId,
        usersNotified: usersToNotify.length,
        pushTokens: allTokens.length,
      });
    } catch (err) {
      logger.error(`Failed to send ${reminderType} reminder for event ${eventId}`, err);
    }
  }
}

/**
 * Scheduled session reminder function.
 * Runs every 5 minutes. Sends reminders for sessions starting in the next 15 minutes.
 * Deduplication: checks for existing session reminder notifications to avoid re-sending.
 */
export const sendSessionReminders = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "europe-west1",
    timeZone: "Africa/Dakar",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const now = Date.now();
    const fromTime = new Date(now).toISOString();
    const toTime = new Date(now + 15 * 60 * 1000).toISOString();

    try {
      // Find sessions starting in the next 15 minutes
      const sessionsSnap = await db
        .collection(COLLECTIONS.SESSIONS)
        .where("startTime", ">=", fromTime)
        .where("startTime", "<=", toTime)
        .get();

      if (sessionsSnap.empty) return;

      for (const sessionDoc of sessionsSnap.docs) {
        const session = sessionDoc.data();
        const sessionId = sessionDoc.id;
        const sessionTitle = session.title ?? "la session";
        const eventId = session.eventId;

        if (!eventId) continue;

        try {
          // Get confirmed registrations for the parent event
          const regsSnap = await db
            .collection(COLLECTIONS.REGISTRATIONS)
            .where("eventId", "==", eventId)
            .where("status", "in", ["confirmed", "checked_in"])
            .get();

          if (regsSnap.empty) continue;

          const userIds = [...new Set(regsSnap.docs.map((d) => d.data().userId))];

          // Deduplication: check which users already received this session reminder
          const reminderKey = "session_reminder";
          const existingReminders = await db
            .collection(COLLECTIONS.NOTIFICATIONS)
            .where("type", "==", reminderKey)
            .where("data.sessionId", "==", sessionId)
            .select("userId")
            .get();

          const alreadyNotified = new Set(existingReminders.docs.map((d) => d.data().userId));
          const usersToNotify = userIds.filter((uid) => !alreadyNotified.has(uid));

          if (usersToNotify.length === 0) continue;

          // Create in-app notifications in batches
          const notifBatches = chunkArray(usersToNotify, 490);
          const nowIso = new Date().toISOString();

          for (const batch of notifBatches) {
            const writeBatch = db.batch();

            for (const userId of batch) {
              // Deterministic ID: one session-reminder of this kind
              // per user per session. Same rationale as the event-
              // reminder path above (at-least-once retry dedup).
              const ref = db
                .collection(COLLECTIONS.NOTIFICATIONS)
                .doc(`reminder_${reminderKey}_${sessionId}_${userId}`);
              writeBatch.set(ref, {
                userId,
                type: reminderKey,
                title: "Session imminente",
                body: `La session '${sessionTitle}' commence bientôt.`,
                data: { eventId, sessionId },
                imageURL: null,
                isRead: false,
                readAt: null,
                createdAt: nowIso,
              });
            }

            await writeBatch.commit();
          }

          // Send FCM push notifications
          const allTokens: string[] = [];
          const userBatches = chunkArray(usersToNotify, 100);

          for (const batch of userBatches) {
            const userDocs = await db.getAll(
              ...batch.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)),
            );
            for (const u of userDocs) {
              if (u.exists) {
                const tokens: string[] = u.data()!.fcmTokens ?? [];
                allTokens.push(...tokens);
              }
            }
          }

          if (allTokens.length > 0) {
            const tokenChunks = chunkArray(allTokens, 500);
            await Promise.allSettled(
              tokenChunks.map((chunk) =>
                messaging.sendEachForMulticast({
                  tokens: chunk,
                  notification: {
                    title: "Session imminente",
                    body: `La session '${sessionTitle}' commence bientôt.`,
                  },
                  data: {
                    type: "session_reminder",
                    eventId,
                    sessionId,
                  },
                  android: { priority: "high" },
                  apns: { payload: { aps: { sound: "default" } } },
                }),
              ),
            );
          }

          logger.info("Session reminder sent", {
            sessionId,
            eventId,
            usersNotified: usersToNotify.length,
            pushTokens: allTokens.length,
          });
        } catch (err) {
          logger.error(`Failed to send session reminder for session ${sessionId}`, err);
        }
      }
    } catch (err) {
      logger.error("Failed to query sessions for reminders", err);
    }
  },
);

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
