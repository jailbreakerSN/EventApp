import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { db, COLLECTIONS } from "../utils/admin";

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
 * Shared logic: create a badge document for a registration.
 * Looks up the org's default template, or uses no template (defaults applied in PDF generation).
 */
async function createBadgeForRegistration(
  regId: string,
  registration: FirebaseFirestore.DocumentData,
): Promise<void> {
  const { eventId, userId, qrCodeValue } = registration;

  // Check if badge already exists to prevent duplicates
  const existingBadge = await db
    .collection(COLLECTIONS.BADGES)
    .where("registrationId", "==", regId)
    .limit(1)
    .get();

  if (!existingBadge.empty) {
    logger.info(`Badge already exists for registration ${regId}, skipping`);
    return;
  }

  // Try to find a default template for the event's organization
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

  // Create badge document — triggers onBadgeCreated for PDF generation
  const now = new Date().toISOString();
  const badgeRef = db.collection(COLLECTIONS.BADGES).doc();
  await badgeRef.set({
    id: badgeRef.id,
    registrationId: regId,
    eventId,
    userId,
    templateId,
    pdfURL: null,
    qrCodeValue,
    generatedAt: now,
    downloadCount: 0,
  });

  logger.info(`Badge ${badgeRef.id} created for registration ${regId}`, {
    eventId,
    userId,
    templateId: templateId || "none",
  });
}
