import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { Webhook } from "svix";
import { FieldValue } from "firebase-admin/firestore";
import { db, COLLECTIONS } from "../../utils/admin";
import { minimalOptions } from "../../utils/function-options";
import { RESEND_WEBHOOK_SECRET } from "../../utils/resend-client";

// Resend signs webhooks with Svix. The payload is verified with the
// `whsec_...` signing secret (written into Secret Manager by
// bootstrapResendInfra) against the svix-id / svix-timestamp /
// svix-signature headers.
//
// Event types we act on:
//   email.bounced      - hard bounce → suppress + deactivate subscriber
//   email.complained   - spam complaint → suppress + deactivate subscriber
//   contact.updated    - Resend-side unsubscribe (one-click) → deactivate
//   contact.deleted    - subscriber removed from segment → deactivate
//
// Everything else (email.sent/delivered/opened/clicked etc.) is ignored
// today — adding observability on those is Phase 3c.
//
// We return 200 for unknown event types so Resend doesn't retry them.
// We return 400 only on signature verification failure.

const PLACEHOLDER_SECRET = "pending-bootstrap";

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    email?: string;
    to?: string[];
    from?: string;
    subject?: string;
    unsubscribed?: boolean;
  };
}

export const resendWebhook = onRequest(
  {
    ...minimalOptions({ maxInstances: 10 }),
    secrets: [RESEND_WEBHOOK_SECRET],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const secret = RESEND_WEBHOOK_SECRET.value();
    if (!secret || secret === PLACEHOLDER_SECRET) {
      // Bootstrap hasn't completed — refuse instead of silently accepting
      // unverified payloads. Resend will retry on 5xx per its schedule.
      logger.warn("Webhook received before bootstrap completed — returning 503");
      res.status(503).send("Webhook not yet configured");
      return;
    }

    // Svix requires the raw body. Firebase Functions v2 onRequest exposes
    // `req.rawBody` (a Buffer) — JSON.parse'ing first would break the hash.
    const payload = (req.rawBody ?? Buffer.alloc(0)).toString("utf8");
    const headers = {
      "svix-id": req.get("svix-id") ?? "",
      "svix-timestamp": req.get("svix-timestamp") ?? "",
      "svix-signature": req.get("svix-signature") ?? "",
    };

    let event: ResendWebhookEvent;
    try {
      const wh = new Webhook(secret);
      event = wh.verify(payload, headers) as ResendWebhookEvent;
    } catch (err) {
      logger.error("Webhook signature verification failed", { err });
      res.status(400).send("Invalid signature");
      return;
    }

    try {
      await handleEvent(event);
    } catch (err) {
      // Let Resend retry. Log with full detail so operators can debug.
      logger.error("Webhook handler failed", { eventType: event.type, err });
      res.status(500).send("Handler error");
      return;
    }

    res.status(200).send("OK");
  },
);

async function handleEvent(event: ResendWebhookEvent): Promise<void> {
  switch (event.type) {
    case "email.bounced": {
      const email = extractEmail(event);
      if (!email) {
        logger.warn("email.bounced missing recipient", { eventData: event.data });
        return;
      }
      await suppressEmail(email, "hard_bounce", event.data.email_id);
      await deactivateSubscriber(email, "hard_bounce");
      logger.info("Suppressed hard-bounced address", { email });
      return;
    }

    case "email.complained": {
      const email = extractEmail(event);
      if (!email) {
        logger.warn("email.complained missing recipient", { eventData: event.data });
        return;
      }
      await suppressEmail(email, "complaint", event.data.email_id);
      await deactivateSubscriber(email, "complaint");
      logger.info("Suppressed complained address", { email });
      return;
    }

    case "contact.updated": {
      // User clicked Resend's one-click unsubscribe link; Resend flipped
      // their contact's `unsubscribed` flag. Mirror back to Firestore so
      // the newsletterSubscribers doc no longer shows them as active.
      if (event.data.unsubscribed === true && event.data.email) {
        await deactivateSubscriber(event.data.email, "resend_unsubscribe");
        logger.info("Deactivated subscriber via Resend one-click unsubscribe", {
          email: event.data.email,
        });
      }
      return;
    }

    case "contact.deleted": {
      if (event.data.email) {
        await deactivateSubscriber(event.data.email, "resend_contact_deleted");
        logger.info("Deactivated subscriber (contact deleted in Resend)", {
          email: event.data.email,
        });
      }
      return;
    }

    default:
      logger.debug("Ignored Resend webhook event", { type: event.type });
  }
}

function extractEmail(event: ResendWebhookEvent): string | undefined {
  // email.bounced / email.complained carry the recipient in `to[0]`; some
  // inbound variants use `email`. Check both.
  return event.data.email ?? event.data.to?.[0];
}

type SuppressionReason =
  | "hard_bounce"
  | "complaint"
  | "resend_unsubscribe"
  | "resend_contact_deleted";

async function suppressEmail(
  email: string,
  reason: SuppressionReason,
  sourceEmailId: string | undefined,
): Promise<void> {
  const normalized = email.toLowerCase();
  await db
    .collection(COLLECTIONS.EMAIL_SUPPRESSIONS)
    .doc(normalized)
    .set(
      {
        email: normalized,
        reason,
        sourceEmailId: sourceEmailId ?? null,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

async function deactivateSubscriber(email: string, reason: SuppressionReason): Promise<void> {
  const normalized = email.toLowerCase();
  const snap = await db
    .collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS)
    .where("email", "==", normalized)
    .limit(1)
    .get();
  if (snap.empty) return;
  const doc = snap.docs[0];
  await doc.ref.update({
    isActive: false,
    deactivatedReason: reason,
    deactivatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
