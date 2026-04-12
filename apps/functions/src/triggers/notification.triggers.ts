import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { db, messaging, COLLECTIONS } from "../utils/admin";

/**
 * Send push notification when a new announcement feed post is created.
 */
export const onFeedPostCreated = onDocumentCreated(
  {
    document: `${COLLECTIONS.FEED_POSTS}/{postId}`,
    region: "europe-west1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const post = snapshot.data();
    if (!post.isAnnouncement) return; // only push for organizer announcements

    try {
      const eventDoc = await db.collection(COLLECTIONS.EVENTS).doc(post.eventId).get();
      if (!eventDoc.exists) return;

      const eventTitle = eventDoc.data()!.title ?? "Événement";

      // Get all confirmed registrations for this event
      const regSnap = await db
        .collection(COLLECTIONS.REGISTRATIONS)
        .where("eventId", "==", post.eventId)
        .where("status", "==", "confirmed")
        .get();

      const userIds = [...new Set(regSnap.docs.map((d) => d.data().userId))];
      if (userIds.length === 0) return;

      // Batch fetch FCM tokens (Firestore getAll limit is ~100 refs)
      const tokens: string[] = [];
      const batches = chunkArray(userIds, 100);

      for (const batch of batches) {
        const userDocs = await db.getAll(
          ...batch.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)),
        );
        for (const u of userDocs) {
          if (u.exists) {
            const fcmTokens: string[] = u.data()!.fcmTokens ?? [];
            tokens.push(...fcmTokens);
          }
        }
      }

      if (tokens.length === 0) return;

      // FCM allows max 500 tokens per multicast
      const tokenChunks = chunkArray(tokens, 500);

      const results = await Promise.allSettled(
        tokenChunks.map((chunk) =>
          messaging.sendEachForMulticast({
            tokens: chunk,
            notification: {
              title: eventTitle,
              body: post.content.slice(0, 140),
            },
            data: {
              type: "new_announcement",
              eventId: post.eventId,
              postId: snapshot.id,
            },
            android: { priority: "high" },
            apns: { payload: { aps: { sound: "default", badge: 1 } } },
          }),
        ),
      );

      const totalSent = results.filter((r) => r.status === "fulfilled").length;
      logger.info(`Announcement push sent to ${tokens.length} tokens (${totalSent} batches)`, {
        postId: snapshot.id,
        eventId: post.eventId,
      });
    } catch (err) {
      logger.error("Failed to send announcement push", err);
    }
  },
);

/**
 * Send a notification when a registration transitions to "confirmed".
 */
export const onRegistrationConfirmed = onDocumentWritten(
  {
    document: `${COLLECTIONS.REGISTRATIONS}/{regId}`,
    region: "europe-west1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!after) return;

    const justConfirmed = before?.status !== "confirmed" && after.status === "confirmed";
    if (!justConfirmed) return;

    try {
      const [userDoc, eventDoc] = await Promise.all([
        db.collection(COLLECTIONS.USERS).doc(after.userId).get(),
        db.collection(COLLECTIONS.EVENTS).doc(after.eventId).get(),
      ]);

      const eventTitle = eventDoc.data()?.title ?? "l'événement";
      const regId = event.data?.after?.id ?? "";

      // Send push notification
      const fcmTokens: string[] = userDoc.data()?.fcmTokens ?? [];
      if (fcmTokens.length > 0) {
        await messaging.sendEachForMulticast({
          tokens: fcmTokens,
          notification: {
            title: "Inscription confirmée !",
            body: `Vous êtes inscrit(e) pour ${eventTitle}. Votre badge est en cours de génération.`,
          },
          data: {
            type: "registration_confirmed",
            registrationId: regId,
            eventId: after.eventId,
          },
        });
      }

      // Save in-app notification
      await db.collection(COLLECTIONS.NOTIFICATIONS).add({
        userId: after.userId,
        type: "registration_confirmed",
        title: "Inscription confirmée",
        body: `Vous êtes inscrit(e) pour ${eventTitle} !`,
        data: { registrationId: regId, eventId: after.eventId },
        imageURL: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      });

      logger.info(`Registration confirmed notification sent`, {
        regId,
        userId: after.userId,
      });
    } catch (err) {
      logger.error("Failed to send registration confirmation notification", err);
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
