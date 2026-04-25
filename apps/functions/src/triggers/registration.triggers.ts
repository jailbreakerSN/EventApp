import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
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
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const registration = snapshot.data();
    if (registration.status !== "confirmed") {
      logger.info(
        `Registration ${snapshot.id} status is '${registration.status}', skipping badge generation`,
      );
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
    memory: "256MiB",
    timeoutSeconds: 60,
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

// ─── B2 (Phase 7+ — Waitlist Automation) ─────────────────────────────────
// The Cloud Function `onRegistrationCancelled` that previously lived here
// duplicated `RegistrationService.promoteNextWaitlisted()` and bypassed
// the domain event bus (it wrote in-app notifications + FCM pushes
// directly, never emitting `waitlist.promoted`). That made the audit
// trail and notification dispatcher inconsistent with single-source-of-
// truth. The API service path now handles promotion end-to-end:
//   - Ticket-type-aware FIFO inside `RegistrationService`.
//   - `eventBus.emit("waitlist.promoted", …)` → audit listener AND
//     notification dispatcher (email + in-app + push via the catalog).
// Removing the trigger eliminates the silent path; nothing calls back
// into the API for this anymore.

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

  // Deterministic badge doc id — same shape `BadgeService.getMyBadge` uses,
  // so the registration-confirmed trigger, the payment-succeeded trigger,
  // the on-demand participant fetch, and the organizer-initiated
  // `generate()` / `bulkGenerate()` all converge on one doc per
  // (eventId, userId). A prior version used random ids with a query-based
  // duplicate check → concurrent writes from two paths could slip through
  // the window between the read and the write.
  const now = new Date().toISOString();
  const badgeId = `${eventId}_${userId}`;
  const badgeRef = db.collection(COLLECTIONS.BADGES).doc(badgeId);

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(badgeRef);
      if (existing.exists) {
        logger.info(`Badge ${badgeId} already exists for registration ${regId}, skipping`);
        return;
      }
      tx.set(badgeRef, {
        id: badgeId,
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

    logger.info(`Badge ${badgeId} created for registration ${regId}`, {
      eventId,
      userId,
      templateId: templateId || "none",
    });
  } catch (err) {
    logger.error(`Failed to create badge for registration ${regId}`, err);
  }
}
