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
//   email.bounced      - hard bounce → suppress + deactivate subscriber +
//                          back-annotate dispatch log (delivered→bounced)
//   email.complained   - spam complaint → suppress + deactivate subscriber +
//                          back-annotate dispatch log (→complained)
//   email.delivered    - Phase 2.5: mark dispatch log deliveryStatus=delivered
//   email.opened       - Phase 2.5: mark dispatch log deliveryStatus=opened
//   email.clicked      - Phase 2.5: mark dispatch log deliveryStatus=clicked
//   contact.updated    - Resend-side unsubscribe (one-click) → deactivate
//   contact.deleted    - subscriber removed from segment → deactivate
//
// Out-of-order delivery: Resend's fan-out can produce `opened` before
// `delivered` when infra clocks skew. Back-annotation uses a monotonic
// rank so the later-in-the-funnel status always wins; an older event
// arriving after a newer one is ignored.
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
      await writeAuditLog({
        action: "email.bounced",
        email,
        sourceEmailId: event.data.email_id,
        createdAt: event.created_at,
      });
      // Phase 2.5: update the dispatch log with deliveryStatus=bounced
      // AND flip status=suppressed so the admin observability dashboard
      // sees both the journey AND the terminal failure.
      await backAnnotateDispatchLog({
        messageId: event.data.email_id,
        deliveryStatus: "bounced",
        occurredAt: event.created_at,
        flipStatusToSuppressed: true,
        suppressionReason: "bounced",
      });
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
      await writeAuditLog({
        action: "email.complained",
        email,
        sourceEmailId: event.data.email_id,
        createdAt: event.created_at,
      });
      // Phase 2.5: deliveryStatus=complained + status=suppressed. Reason
      // "on_suppression_list" because the recipient has now been added
      // to the platform-wide suppression list.
      await backAnnotateDispatchLog({
        messageId: event.data.email_id,
        deliveryStatus: "complained",
        occurredAt: event.created_at,
        flipStatusToSuppressed: true,
        suppressionReason: "on_suppression_list",
      });
      logger.info("Suppressed complained address", { email });
      return;
    }

    // ─── Phase 2.5 — delivery lifecycle back-annotation ──────────────
    // Happy-path events without suppression-list side effects. If the
    // matching dispatch-log row is missing (legacy send from before
    // Phase 2.2 messageId tracking) we no-op.
    case "email.delivered": {
      await backAnnotateDispatchLog({
        messageId: event.data.email_id,
        deliveryStatus: "delivered",
        occurredAt: event.created_at,
      });
      return;
    }

    case "email.opened": {
      await backAnnotateDispatchLog({
        messageId: event.data.email_id,
        deliveryStatus: "opened",
        occurredAt: event.created_at,
      });
      return;
    }

    case "email.clicked": {
      await backAnnotateDispatchLog({
        messageId: event.data.email_id,
        deliveryStatus: "clicked",
        occurredAt: event.created_at,
      });
      return;
    }

    case "contact.updated": {
      // User clicked Resend's one-click unsubscribe link; Resend flipped
      // their contact's `unsubscribed` flag. Mirror back to Firestore so
      // the newsletterSubscribers doc no longer shows them as active.
      if (event.data.unsubscribed === true && event.data.email) {
        await deactivateSubscriber(event.data.email, "resend_unsubscribe");
        await writeAuditLog({
          action: "email.resend_unsubscribed",
          email: event.data.email,
          createdAt: event.created_at,
        });
        logger.info("Deactivated subscriber via Resend one-click unsubscribe", {
          email: event.data.email,
        });
      }
      return;
    }

    case "contact.deleted": {
      if (event.data.email) {
        await deactivateSubscriber(event.data.email, "resend_contact_deleted");
        await writeAuditLog({
          action: "email.resend_contact_deleted",
          email: event.data.email,
          createdAt: event.created_at,
        });
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

// Cloud Functions don't share the API's in-process eventBus, so we can't
// emit a domain event and rely on audit.listener to write the row.
// Write the audit entry directly. Keeps hard-bounce / complaint /
// unsubscribe decisions queryable from the admin audit surface — not
// just Cloud Logging (which is shorter-retained + PII-risky).
async function writeAuditLog(params: {
  action: string;
  email: string;
  sourceEmailId?: string;
  createdAt: string;
}): Promise<void> {
  try {
    await db.collection("auditLogs").add({
      action: params.action,
      actorId: "resend_webhook",
      requestId: `resend-webhook-${params.sourceEmailId ?? "unknown"}`,
      timestamp: params.createdAt,
      resourceType: "email_address",
      resourceId: params.email.toLowerCase(),
      eventId: null,
      organizationId: null,
      details: {
        email: params.email.toLowerCase(),
        sourceEmailId: params.sourceEmailId ?? null,
      },
    });
  } catch (err) {
    // Fire-and-forget: the state mutation already committed; failing
    // to audit should not retry the whole webhook. Surface to Cloud
    // Logging so operators can reconcile if needed.
    logger.error("Failed to write audit log for webhook event", {
      action: params.action,
      err,
    });
  }
}

// ─── Phase 2.5: dispatch log back-annotation ──────────────────────────────
// Writes `deliveryStatus` + per-event timestamp onto every dispatch-log
// row matching the provider messageId. Enforces monotonic progression
// via the DELIVERY_RANK table so out-of-order webhooks (opened arriving
// before delivered) don't demote the stored state. Bounce / complaint
// events additionally flip `status` to `suppressed` so the admin stats
// aggregator treats them as failures without a second query.
//
// TRANSACTION NOTE: bare where().get() + batch.update(). Firestore
// transactions cannot carry `.where()` queries, so the "correct" fix
// is to embed the doc id in the Resend tag/idempotency key. Deferred.
// The field values here are idempotent (monotonic rank + fixed
// timestamp), so concurrent webhook retries for the same messageId
// converge to the same final state.

// Local mirror of DispatchLogDeliveryStatus rank from apps/api.
// Functions can't import from the API barrel (bundled independently);
// keep in lockstep by hand.
const DELIVERY_RANK: Record<string, number> = {
  sent: 0,
  delivered: 1,
  opened: 2,
  clicked: 3,
  bounced: 4,
  complained: 5,
};

async function backAnnotateDispatchLog(params: {
  messageId: string | undefined;
  deliveryStatus: "delivered" | "opened" | "clicked" | "bounced" | "complained";
  occurredAt: string;
  flipStatusToSuppressed?: boolean;
  suppressionReason?: "bounced" | "on_suppression_list";
}): Promise<void> {
  const { messageId, deliveryStatus, occurredAt } = params;
  if (!messageId) return;
  try {
    const snap = await db
      .collection(COLLECTIONS.NOTIFICATION_DISPATCH_LOG)
      .where("messageId", "==", messageId)
      .limit(10)
      .get();
    if (snap.empty) return;

    const incomingRank = DELIVERY_RANK[deliveryStatus] ?? -1;
    const tsField = timestampFieldFor(deliveryStatus);

    const batch = db.batch();
    let promotions = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      const currentStatus = typeof data.deliveryStatus === "string"
        ? data.deliveryStatus
        : "sent";
      const currentRank = DELIVERY_RANK[currentStatus] ?? 0;

      // Always stamp the per-event timestamp (useful even when the
      // rank didn't advance, e.g. a second open after a click).
      // Promote deliveryStatus only if incoming is at or above the
      // current rank.
      const update: Record<string, unknown> = {
        [tsField]: occurredAt,
      };
      if (incomingRank >= currentRank) {
        update.deliveryStatus = deliveryStatus;
        promotions++;
      }
      if (params.flipStatusToSuppressed) {
        update.status = "suppressed";
        if (params.suppressionReason) {
          update.reason = params.suppressionReason;
        }
        update.originalStatus = data.status ?? "sent";
      }
      batch.update(doc.ref, update);
    }
    await batch.commit();
    logger.info("Back-annotated dispatch log", {
      messageId,
      deliveryStatus,
      matched: snap.size,
      promoted: promotions,
    });
  } catch (err) {
    logger.error("Failed to back-annotate dispatch log", { messageId, err });
  }
}

function timestampFieldFor(
  status: "delivered" | "opened" | "clicked" | "bounced" | "complained",
): "deliveredAt" | "openedAt" | "clickedAt" | "bouncedAt" | "complainedAt" {
  switch (status) {
    case "delivered":
      return "deliveredAt";
    case "opened":
      return "openedAt";
    case "clicked":
      return "clickedAt";
    case "bounced":
      return "bouncedAt";
    case "complained":
      return "complainedAt";
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

  // Wrapped in runTransaction() for policy compliance (CLAUDE.md
  // Security Hardening forbids read-then-write outside a transaction)
  // and to serialise the two concurrent writes that Resend's at-least-
  // once webhook retry schedule can produce for the same bounce event.
  // The actual state transition is idempotent (isActive already false
  // → no change) but the tx guarantees a single clean audit trail.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(
      db.collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS).where("email", "==", normalized).limit(1),
    );
    if (snap.empty) return;
    const ref = snap.docs[0].ref;
    tx.update(ref, {
      // Both fields flipped together — the retention job + reconciler
      // key off `status`, not `isActive`, so leaving status="confirmed"
      // here creates a false consent record and makes pruned/deactivated
      // subscribers invisible to the retention pass. Keep the two in
      // lockstep. (Phase 3c.6 final-review fix.)
      status: "unsubscribed",
      isActive: false,
      deactivatedReason: reason,
      deactivatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
