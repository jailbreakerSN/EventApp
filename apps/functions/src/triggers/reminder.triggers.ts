import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db, messaging, COLLECTIONS } from "../utils/admin";

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
          const ref = db.collection(COLLECTIONS.NOTIFICATIONS).doc();
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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
