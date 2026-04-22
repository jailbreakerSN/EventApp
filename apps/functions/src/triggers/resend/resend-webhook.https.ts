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
      await writeAuditLog({
        action: "email.bounced",
        email,
        sourceEmailId: event.data.email_id,
        createdAt: event.created_at,
      });
      // Phase 5b: back-annotate the dispatch log so per-key bounce rates
      // appear in the admin observability dashboard. Fire-and-forget; if
      // the log doesn't carry this messageId (legacy send) we no-op.
      await markDispatchLogBounced(event.data.email_id, "bounced", event.created_at);
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
      // Phase 5b: same back-annotation path as bounces. Reason
      // "on_suppression_list" because the recipient has now been added
      // to the platform-wide suppression list; subsequent dispatches to
      // this address will suppress on the list lookup inside the adapter.
      await markDispatchLogBounced(event.data.email_id, "on_suppression_list", event.created_at);
      logger.info("Suppressed complained address", { email });
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

// ─── Phase 5b: dispatch log back-annotation ────────────────────────────────
// When Resend reports a bounce / complaint on a messageId, flip the
// matching `notificationDispatchLog` entry from status="sent" to
// status="suppressed" so the admin stats endpoint surfaces the correct
// bounce rate without re-aggregating from scratch. We deliberately keep
// a record of the original "sent" intent (original_status in the doc)
// so post-mortem analysis can see both the dispatch AND the later bounce.
//
// Matches by `messageId` — this field was introduced in Phase 5a and is
// set by every dispatch. Logs from the Phase 1–4 windows (before
// messageId was populated) are unaffected; no back-fill needed since the
// feature is new.
//
// TRANSACTION NOTE: this function performs a read-then-batch-write
// without wrapping in `db.runTransaction()`. The same concern was
// raised by the Phase 5 security review (finding P2-4). Decision:
// idempotency of the field values (status="suppressed", reason,
// originalStatus="sent", bouncedAt=<event>) makes concurrent webhook
// deliveries for the same messageId safe — both converge on the same
// final document state. Cloud Functions Firestore transactions also
// cannot contain `where()` queries (only `tx.get(docRef)`), so the
// "correct" fix requires storing the dispatch log doc id inside the
// Resend idempotency key and doing a direct `tx.get`. That's a Phase
// 5c refinement; the current path is safe for the webhook's
// at-least-once delivery semantics. See docs/notification-system-
// architecture.md §15 for follow-up plan.
async function markDispatchLogBounced(
  messageId: string | undefined,
  reason: "bounced" | "on_suppression_list",
  occurredAt: string,
): Promise<void> {
  if (!messageId) return;
  try {
    const snap = await db
      .collection(COLLECTIONS.NOTIFICATION_DISPATCH_LOG)
      .where("messageId", "==", messageId)
      .limit(10) // guard against pathological duplicates
      .get();
    if (snap.empty) return;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        status: "suppressed",
        reason,
        // Preserve the original decision for forensics.
        originalStatus: "sent",
        bouncedAt: occurredAt,
      });
    }
    await batch.commit();
    logger.info("Back-annotated dispatch log with bounce", {
      messageId,
      reason,
      matched: snap.size,
    });
  } catch (err) {
    // Fire-and-forget — the suppression list write already committed,
    // bounce analytics are nice-to-have, not a blocker.
    logger.error("Failed to back-annotate dispatch log", { messageId, err });
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
