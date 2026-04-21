import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getResend, RESEND_API_KEY } from "../../utils/resend-client";
import { minimalOptions } from "../../utils/function-options";
import { getResendSystemConfig } from "./config-store";

// Mirrors Firestore → Resend on subscriber doc updates. Handles two
// distinct transitions:
//
//   1. Double-opt-in completion: status "pending" → "confirmed".
//      The onCreated trigger skipped this row because it was pending;
//      now we create the Resend contact in the Segment. This is how a
//      real subscriber lands in the marketing list.
//
//   2. Activation flip: isActive true ↔ false.
//      Admin deactivated (or a Phase 3c.5 retention job did), OR the
//      user clicked the in-body unsubscribe link. Either way we mirror
//      the flag to the Resend contact so broadcasts skip them.
//
// The reverse direction (Resend-side one-click unsubscribe → Firestore)
// is handled by resendWebhook, not here.

export const onNewsletterSubscriberUpdated = onDocumentUpdated(
  {
    ...minimalOptions({ maxInstances: 5 }),
    document: "newsletterSubscribers/{subscriberId}",
    secrets: [RESEND_API_KEY],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const email = after.email as string | undefined;
    if (!email) return;

    const beforeStatus = before.status as string | undefined;
    const afterStatus = after.status as string | undefined;
    const statusChanged = beforeStatus !== afterStatus;
    const activeChanged = before.isActive !== after.isActive;

    // Transition 1 — pending → confirmed. This is the "user clicked the
    // double-opt-in link" moment. Mirror them into the Segment now.
    if (statusChanged && afterStatus === "confirmed") {
      const { newsletterSegmentId } = await getResendSystemConfig();
      if (!newsletterSegmentId) {
        logger.info("Confirmed subscriber but segment not configured — skipping mirror", {
          subscriberId: event.params.subscriberId,
        });
        return;
      }

      const { data, error } = await getResend().contacts.create({
        email,
        segments: [{ id: newsletterSegmentId }],
      });

      if (error) {
        const isDuplicate =
          error.name === "invalid_idempotent_request" ||
          /already exists|duplicate/i.test(error.message);
        if (isDuplicate) {
          logger.info("Contact already exists in Resend — no-op on confirmation", { email });
          return;
        }
        logger.error("Failed to mirror confirmed subscriber to Resend", {
          subscriberId: event.params.subscriberId,
          error: { name: error.name, message: error.message },
        });
        throw new Error(`Resend contacts.create failed: ${error.name}: ${error.message}`);
      }

      logger.info("Mirrored confirmed subscriber to Resend segment", {
        subscriberId: event.params.subscriberId,
        contactId: data?.id,
      });
      return;
    }

    // Transition 2 — isActive flipped (and status didn't change). This is
    // the admin-deactivate path. Nothing to do if status also changed —
    // a pending row being deactivated doesn't need a Resend update because
    // the contact was never created in the first place.
    if (activeChanged && !statusChanged) {
      const { error } = await getResend().contacts.update({
        email,
        unsubscribed: !after.isActive,
      });

      if (error) {
        logger.error("Failed to update Resend contact unsubscribed flag", {
          subscriberId: event.params.subscriberId,
          email,
          isActive: after.isActive,
          error: { name: error.name, message: error.message },
        });
        throw new Error(`Resend contacts.update failed: ${error.name}: ${error.message}`);
      }

      logger.info("Updated Resend contact unsubscribed flag", {
        subscriberId: event.params.subscriberId,
        unsubscribed: !after.isActive,
      });
    }
  },
);
