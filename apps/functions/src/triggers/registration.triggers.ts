import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { db, messaging, COLLECTIONS } from "../utils/admin";

/**
 * Auto-generate a badge when a registration is created with status "confirmed".
 * Creates a badge document in Firestore, which triggers onBadgeCreated for PDF generation.
 */
export const onRegistrationCreated = onDocumentCreated(
  {
    document: `${COLLECTIONS.REGISTRATIONS}/{regId}`,
    region: "europe-west1",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const registration = snapshot.data();
    if (registration.status !== "confirmed") {
      logger.info(`Registration ${snapshot.id} status is '${registration.status}', skipping badge generation`);
      return;
    }

    await createBadgeForRegistration(snapshot.id, registration);
  },
);

/**
 * Auto-generate a badge when a registration is approved (status changes to "confirmed").
 * Covers waitlist promotions and manual approvals.
 */
export const onRegistrationApproved = onDocumentUpdated(
  {
    document: `${COLLECTIONS.REGISTRATIONS}/{regId}`,
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // Only trigger when status transitions TO "confirmed"
    if (before.status === after.status) return;
    if (after.status !== "confirmed") return;

    const regId = event.data!.after.id;
    logger.info(`Registration ${regId} approved (${before.status} → confirmed), generating badge`);

    await createBadgeForRegistration(regId, after);
  },
);

/**
 * When a registration is cancelled, promote the oldest waitlisted registration.
 * Uses a transaction to safely read and update the waitlisted registration.
 */
export const onRegistrationCancelled = onDocumentWritten(
  {
    document: `${COLLECTIONS.REGISTRATIONS}/{regId}`,
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!after) return;

    const justCancelled = before?.status !== "cancelled" && after.status === "cancelled";
    if (!justCancelled) return;

    const eventId = after.eventId;
    const regId = event.data?.after?.id ?? "";

    logger.info(`Registration ${regId} cancelled, checking waitlist for event ${eventId}`);

    try {
      // Find the oldest waitlisted registration for this event
      const waitlistSnap = await db
        .collection(COLLECTIONS.REGISTRATIONS)
        .where("eventId", "==", eventId)
        .where("status", "==", "waitlisted")
        .orderBy("createdAt", "asc")
        .limit(1)
        .get();

      if (waitlistSnap.empty) {
        logger.info(`No waitlisted registrations for event ${eventId}`);
        return;
      }

      const waitlistedDoc = waitlistSnap.docs[0];
      const waitlistedReg = waitlistedDoc.data();
      const now = new Date().toISOString();

      // Promote via transaction to avoid race conditions
      await db.runTransaction(async (tx) => {
        const freshDoc = await tx.get(waitlistedDoc.ref);
        const freshData = freshDoc.data();

        // Re-check status inside transaction (another cancellation may have promoted this one already)
        if (!freshData || freshData.status !== "waitlisted") {
          logger.info(`Waitlisted registration ${waitlistedDoc.id} already promoted, skipping`);
          return;
        }

        tx.update(waitlistedDoc.ref, {
          status: "confirmed",
          updatedAt: now,
          promotedFromWaitlistAt: now,
        });
      });

      // Fetch event title for notification
      const eventDoc = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
      const eventTitle = eventDoc.data()?.title ?? "l'événement";

      // Create in-app notification for the promoted user
      await db.collection(COLLECTIONS.NOTIFICATIONS).add({
        userId: waitlistedReg.userId,
        type: "waitlist_promoted",
        title: "Place confirmée !",
        body: `Bonne nouvelle ! Votre place pour ${eventTitle} est confirmée.`,
        data: {
          eventId,
          registrationId: waitlistedDoc.id,
        },
        imageURL: null,
        isRead: false,
        readAt: null,
        createdAt: now,
      });

      // Send FCM push if user has tokens
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(waitlistedReg.userId).get();
      const fcmTokens: string[] = userDoc.data()?.fcmTokens ?? [];

      if (fcmTokens.length > 0) {
        await messaging.sendEachForMulticast({
          tokens: fcmTokens,
          notification: {
            title: "Place confirmée !",
            body: `Bonne nouvelle ! Votre place pour ${eventTitle} est confirmée.`,
          },
          data: {
            type: "waitlist_promoted",
            eventId,
            registrationId: waitlistedDoc.id,
          },
          android: { priority: "high" },
          apns: { payload: { aps: { sound: "default", badge: 1 } } },
        });
      }

      logger.info(`Waitlist promotion: ${waitlistedDoc.id} promoted for event ${eventId}`, {
        promotedUserId: waitlistedReg.userId,
        cancelledRegId: regId,
      });
    } catch (err) {
      logger.error(`Failed to promote waitlisted registration for event ${eventId}`, err);
    }
  },
);

/**
 * Shared logic: create a badge document for a registration.
 * Uses a transaction to atomically check for duplicates and create the badge.
 * Looks up the org's default template, or uses no template (defaults applied in PDF generation).
 */
async function createBadgeForRegistration(
  regId: string,
  registration: FirebaseFirestore.DocumentData,
): Promise<void> {
  const { eventId, userId, qrCodeValue } = registration;

  // Look up default template before the transaction (read-only, no consistency concern)
  let templateId = "";
  try {
    const eventDoc = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
    if (eventDoc.exists) {
      const orgId = eventDoc.data()?.organizationId;
      if (orgId) {
        const defaultTemplate = await db
          .collection(COLLECTIONS.BADGE_TEMPLATES)
          .where("organizationId", "==", orgId)
          .where("isDefault", "==", true)
          .limit(1)
          .get();

        if (!defaultTemplate.empty) {
          templateId = defaultTemplate.docs[0].id;
        }
      }
    }
  } catch (err) {
    logger.warn(`Failed to find default template for registration ${regId}`, err);
  }

  // Atomic duplicate check + create inside a transaction
  const now = new Date().toISOString();
  const badgeRef = db.collection(COLLECTIONS.BADGES).doc();

  try {
    await db.runTransaction(async (tx) => {
      // Check for existing badge inside the transaction
      const existingBadge = await tx.get(
        db.collection(COLLECTIONS.BADGES)
          .where("registrationId", "==", regId)
          .limit(1),
      );

      if (!existingBadge.empty) {
        logger.info(`Badge already exists for registration ${regId}, skipping`);
        return;
      }

      tx.set(badgeRef, {
        id: badgeRef.id,
        registrationId: regId,
        eventId,
        userId,
        templateId,
        status: "pending",
        pdfURL: null,
        qrCodeValue,
        error: null,
        generatedAt: now,
        downloadCount: 0,
      });
    });

    logger.info(`Badge ${badgeRef.id} created for registration ${regId}`, {
      eventId,
      userId,
      templateId: templateId || "none",
    });
  } catch (err) {
    logger.error(`Failed to create badge for registration ${regId}`, err);
  }
}
