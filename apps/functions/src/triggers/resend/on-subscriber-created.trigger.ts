import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getResend, RESEND_API_KEY } from "../../utils/resend-client";
import { minimalOptions } from "../../utils/function-options";
import { getResendSystemConfig } from "./config-store";

// Fires when the API (or an admin tool) writes a new newsletterSubscribers
// document. Mirrors the subscriber into the Resend Segment so the next
// broadcast reaches them.
//
// Why this lives in Functions and not in the API service:
//   - Decouples subscribe-response latency from Resend availability.
//   - Firestore triggers are retried on failure for up to 7 days with
//     exponential backoff — we get robust at-least-once delivery for free.
//   - A deploy that changes nothing in Functions still catches up on any
//     subscriptions that failed to mirror while Resend was down.

export const onNewsletterSubscriberCreated = onDocumentCreated(
  {
    ...minimalOptions({ maxInstances: 5 }),
    document: "newsletterSubscribers/{subscriberId}",
    secrets: [RESEND_API_KEY],
    // Keep retry quiet: Firestore triggers retry automatically on thrown
    // errors. Set retry=true if Phase 3c wants strong guarantees; for now
    // we log + give up on non-retryable errors so they don't loop forever.
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    const email = data.email as string | undefined;
    const status = data.status as string | undefined;

    if (!email) {
      logger.warn("Subscriber doc missing email — skipping mirror", {
        subscriberId: event.params.subscriberId,
      });
      return;
    }

    // Double opt-in gate (Phase 3c.2): never mirror a pending subscriber
    // into the Resend Segment. Once the user clicks the confirmation
    // link, status flips to "confirmed" and the onUpdated trigger fires
    // the mirror. Rows without a `status` field are treated as
    // already-confirmed (back-compat with pre-3c.2 subscribers).
    if (status !== undefined && status !== "confirmed") {
      logger.info("Subscriber not yet confirmed — skipping Resend mirror", {
        subscriberId: event.params.subscriberId,
        status,
      });
      return;
    }

    const { newsletterSegmentId } = await getResendSystemConfig();
    if (!newsletterSegmentId) {
      // Bootstrap hasn't run yet — not an error, just not ready. The
      // scheduled reconciler will pick these up once the segment exists.
      logger.info("Resend segment not configured — skipping mirror", {
        subscriberId: event.params.subscriberId,
      });
      return;
    }

    const { data: contact, error } = await getResend().contacts.create({
      email,
      segments: [{ id: newsletterSegmentId }],
    });

    if (error) {
      // Duplicate contact (409) is desired state — Resend already has this
      // email in an audience. Treat as success so we don't retry forever.
      const isDuplicate =
        error.name === "invalid_idempotent_request" ||
        /already exists|duplicate/i.test(error.message);
      if (isDuplicate) {
        logger.info("Contact already exists in Resend — no-op", { email });
        return;
      }
      // Any other error: log + rethrow so Firestore retries with backoff.
      logger.error("Failed to mirror subscriber to Resend", {
        subscriberId: event.params.subscriberId,
        error: { name: error.name, message: error.message },
      });
      throw new Error(`Resend contacts.create failed: ${error.name}: ${error.message}`);
    }

    logger.info("Mirrored subscriber to Resend segment", {
      subscriberId: event.params.subscriberId,
      contactId: contact?.id,
      segmentId: newsletterSegmentId,
    });
  },
);
