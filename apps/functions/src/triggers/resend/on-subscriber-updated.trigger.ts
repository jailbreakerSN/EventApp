import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getResend, RESEND_API_KEY } from "../../utils/resend-client";
import { minimalOptions } from "../../utils/function-options";

// Mirrors Firestore → Resend when a subscriber's `isActive` flag flips.
// Covers the flow where an admin (or a future user-facing unsubscribe
// endpoint) marks a subscriber inactive: we keep the Firestore row for
// history but flip the Resend contact to `unsubscribed: true` so future
// broadcasts skip them.
//
// The reverse direction (Resend-side unsubscribe → Firestore) is handled
// by resendWebhook, not here — webhook is the only source of truth for
// Gmail/Yahoo one-click unsubscribes.

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

    // Only run when the active flag actually changed. Every other doc
    // edit (e.g. updatedAt touch) is ignored — no point hammering Resend.
    if (before.isActive === after.isActive) return;

    const email = after.email as string | undefined;
    if (!email) return;

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
  },
);
