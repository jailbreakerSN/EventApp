import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { db, COLLECTIONS } from "../utils/admin";

/**
 * Fires when a registration status changes to "checked_in".
 * Writes a check-in feed entry for the real-time dashboard.
 */
export const onCheckinCompleted = onDocumentUpdated(
  {
    document: `${COLLECTIONS.REGISTRATIONS}/{regId}`,
    region: "europe-west1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // Only trigger on transition TO "checked_in"
    if (before.status === after.status) return;
    if (after.status !== "checked_in") return;

    const regId = event.data!.after.id;
    const { eventId, userId, ticketTypeId, accessZoneId, checkedInAt, checkedInBy } = after;

    logger.info(`Check-in completed for registration ${regId}`, { eventId, userId });

    // Write a feed entry for real-time dashboard polling.
    //
    // Deterministic doc ID derived from the registration id: Firebase
    // Functions delivery is at-least-once, so a retry of the same
    // check-in transition would otherwise create a duplicate feed row
    // (the dashboard would show the participant checking in twice).
    // One registration → one feed entry is the correct invariant.
    try {
      const feedRef = db.collection(COLLECTIONS.CHECKIN_FEED).doc(`checkin_${regId}`);

      // Fetch participant name for the feed entry
      let participantName: string | null = null;
      let participantEmail: string | null = null;
      try {
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          participantName = userData?.displayName ?? null;
          participantEmail = userData?.email ?? null;
        }
      } catch {
        // Non-blocking — feed entry works without participant name
      }

      // Fetch ticket type name and organizationId from event
      let ticketTypeName = "Unknown";
      let organizationId: string | null = null;
      try {
        const eventDoc = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
        if (eventDoc.exists) {
          const eventData = eventDoc.data();
          organizationId = eventData?.organizationId ?? null;
          const tt = eventData?.ticketTypes?.find((t: { id: string }) => t.id === ticketTypeId);
          if (tt) ticketTypeName = tt.name;
        }
      } catch {
        // Non-blocking
      }

      await feedRef.set({
        id: feedRef.id,
        eventId,
        organizationId,
        registrationId: regId,
        userId,
        participantName,
        participantEmail,
        ticketTypeId,
        ticketTypeName,
        accessZoneId: accessZoneId ?? null,
        checkedInAt: checkedInAt ?? new Date().toISOString(),
        checkedInBy: checkedInBy ?? null,
        createdAt: new Date().toISOString(),
      });

      logger.info(`Check-in feed entry ${feedRef.id} created for registration ${regId}`);
    } catch (err) {
      logger.error(`Failed to write check-in feed entry for registration ${regId}`, err);
    }
  },
);
