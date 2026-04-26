import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db, messaging, COLLECTIONS } from "../utils/admin";
import { productionOnly } from "../utils/env";

/**
 * Payment timeout — auto-expires payments stuck without resolution.
 *
 * Phase 2 follow-up rewrite: aligned with the canonical state machine
 * established by P1-21 (`expire-stale-payments` admin job) and the
 * Phase 2 `payment.expired` domain event.
 *
 * What changed from the original
 * ──────────────────────────────
 *   - Targets BOTH `pending` (Phase-1 P1-07 placeholders that never
 *     completed initiate tx2) AND `processing` (user redirected to
 *     PayDunya but never came back). The previous shape only swept
 *     `processing`, leaving stale `pending` rows accumulating
 *     indefinitely whenever the provider call failed.
 *   - Sets `status = "expired"` (not `"failed"`). Failed = provider
 *     explicitly rejected; expired = timeout. Distinct so the audit
 *     grid + dispatcher can render targeted operator copy.
 *   - TTL configurable via `PAYMENT_TIMEOUT_MS` env var. Default 30 min
 *     for production behaviour parity; staging can override to a
 *     shorter window via Cloud Run env injection.
 *   - registeredCount NOT decremented — `pending_payment` and `pending`
 *     placeholders never increment the counter (only the
 *     `payment.succeeded` IPN path does, cf. Phase 1 P1-04).
 *   - Mirrors the user-initiated cancel path's invariants: linked
 *     Registration flips to `cancelled` only when its status is
 *     `pending_payment` (defensive — never touch a registration that
 *     somehow became `confirmed` between the outer query and the batch
 *     commit; the IPN race is covered by the inner-tx idempotency
 *     guard in handleWebhook).
 *
 * Cron cadence: every 5 minutes. The 30-min TTL means the user has up
 * to 35 min to complete the PayDunya flow before the placeholder
 * registration is released for re-registration. Tweak via
 * `PAYMENT_TIMEOUT_MS` if needed.
 */
export const onPaymentTimeout = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "europe-west1",
    timeZone: "Africa/Dakar",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS) || 30 * 60 * 1000;
    const cutoff = new Date(Date.now() - TIMEOUT_MS).toISOString();

    // Sweep BOTH pending (Phase-1 P1-07 placeholder, no provider session)
    // AND processing (user redirected, no IPN yet). Two queries because
    // Firestore `where in` with `<` orderBy on a different field
    // requires a composite index on (status, createdAt) which exists
    // for "==" queries but the `in` form would need a separate index.
    // Two simple queries are cheap and avoid the index proliferation.
    const [pendingSnap, processingSnap] = await Promise.all([
      db
        .collection(COLLECTIONS.PAYMENTS)
        .where("status", "==", "pending")
        .where("createdAt", "<", cutoff)
        .limit(50)
        .get(),
      db
        .collection(COLLECTIONS.PAYMENTS)
        .where("status", "==", "processing")
        .where("createdAt", "<", cutoff)
        .limit(50)
        .get(),
    ]);

    const docs = [...pendingSnap.docs, ...processingSnap.docs];
    if (docs.length === 0) return;

    let expired = 0;
    let raced = 0;

    // ADR-0017 + senior review fix (firestore-transaction-auditor):
    // Each Payment must be expired in its own runTransaction with a fresh
    // re-read inside the tx callback so a successful IPN that lands
    // between the outer query and our write CANNOT be silently overwritten
    // by an `expired` flip. The previous batch shape had no such guard —
    // a confirmed Payment + Registration could be wiped to expired/cancelled
    // by a racing scheduler tick.
    //
    // Trade-off: 1 transaction per stuck payment vs. one batch commit. With
    // a `limit(50)` per query the worst-case fan-out is 100 small txs per
    // tick, well within Firestore's quota and within the 120s timeout.
    for (const doc of docs) {
      try {
        const result = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (!fresh.exists) return "missing" as const;
          const freshData = fresh.data() as { status?: string; registrationId?: string };

          // Idempotency guard: only flip if the payment is STILL in a
          // non-terminal state. A racing IPN may have already moved it
          // to succeeded / failed / refunded — leave that alone.
          if (freshData.status !== "pending" && freshData.status !== "processing") {
            return "raced" as const;
          }

          const txNow = new Date().toISOString();

          tx.update(doc.ref, {
            status: "expired",
            failureReason: "Paiement expiré : aucun retour fournisseur après le délai imparti",
            updatedAt: txNow,
          });

          // Release the linked Registration's slot if it's still in
          // pending_payment. registeredCount is NOT decremented because
          // pending_payment never incremented it (Phase 1 P1-04 invariant).
          if (freshData.registrationId) {
            const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(freshData.registrationId);
            const reg = await tx.get(regRef);
            const regStatus = (reg.data() as { status?: string } | undefined)?.status;
            // Defense: never overwrite a registration that somehow became
            // confirmed / cancelled between query and tx commit.
            if (regStatus === "pending_payment") {
              tx.update(regRef, {
                status: "cancelled",
                updatedAt: txNow,
              });
            }
          }

          return "expired" as const;
        });

        if (result === "expired") {
          expired += 1;

          // Audit log write — required by domain-event-auditor since the
          // API-side eventBus listener in audit.listener.ts is unreachable
          // from a Cloud Function. Two entries (one per affected resource)
          // mirror the `payment.expired` + `registration.cancelled` events
          // emitted by the user-initiated `cancelPending` path.
          const payment = doc.data();
          const auditNow = new Date().toISOString();
          await Promise.all([
            db.collection(COLLECTIONS.AUDIT_LOGS).add({
              actorId: "system:onPaymentTimeout",
              action: "payment.expired",
              resourceType: "payment",
              resourceId: doc.id,
              organizationId: payment.organizationId ?? null,
              eventId: payment.eventId ?? null,
              details: {
                reason: "timeout",
                registrationId: payment.registrationId ?? null,
                timeoutMs: TIMEOUT_MS,
              },
              createdAt: auditNow,
            }),
            payment.registrationId
              ? db.collection(COLLECTIONS.AUDIT_LOGS).add({
                  actorId: "system:onPaymentTimeout",
                  action: "registration.cancelled",
                  resourceType: "registration",
                  resourceId: payment.registrationId,
                  organizationId: payment.organizationId ?? null,
                  eventId: payment.eventId ?? null,
                  details: {
                    reason: "payment_timeout",
                    paymentId: doc.id,
                  },
                  createdAt: auditNow,
                })
              : Promise.resolve(),
          ]).catch((auditErr) => {
            // Audit failure must not roll back the state-machine flip.
            logger.error("Failed to write audit log for expired payment", {
              paymentId: doc.id,
              err: auditErr,
            });
          });
        } else if (result === "raced") {
          raced += 1;
        }
      } catch (err) {
        logger.error("Failed to expire stale payment", {
          paymentId: doc.id,
          err,
        });
      }
    }

    logger.info(`Payment timeout sweep done`, {
      cutoff,
      timeoutMs: TIMEOUT_MS,
      expired,
      raced,
      pendingScanned: pendingSnap.size,
      processingScanned: processingSnap.size,
    });
  },
);

/**
 * When a payment transitions to "succeeded", trigger badge generation.
 * This ensures badges are created even if the API event bus missed the webhook.
 */
export const onPaymentSucceeded = onDocumentWritten(
  {
    document: `${COLLECTIONS.PAYMENTS}/{paymentId}`,
    region: "europe-west1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!after) return;

    const justSucceeded = before?.status !== "succeeded" && after.status === "succeeded";
    if (!justSucceeded) return;

    try {
      // Fetch the registration outside the transaction — we need it for
      // the qrCodeValue / userId fields the badge doc copies. Safe to
      // read once: the registration is immutable after confirmation.
      const reg = await db.collection(COLLECTIONS.REGISTRATIONS).doc(after.registrationId).get();
      const regData = reg.data();
      if (!regData) return;

      // Deterministic badge doc id — single source of truth for the
      // (eventId, userId) pair. Four writers (this trigger, the
      // registration-confirmed trigger, the organizer `generate` /
      // `bulkGenerate` API, and the on-demand `getMyBadge`) all land
      // on the same doc, so concurrent fires collapse to one document
      // without needing the old where-query-based duplicate check.
      const userId = after.userId ?? regData.userId;
      const badgeId = `${after.eventId}_${userId}`;
      const badgeRef = db.collection(COLLECTIONS.BADGES).doc(badgeId);
      let didCreate = false;
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(badgeRef);
        if (existing.exists) {
          logger.info("Badge already exists for registration, skipping", {
            registrationId: after.registrationId,
            badgeId,
          });
          return;
        }
        tx.set(badgeRef, {
          id: badgeId,
          registrationId: after.registrationId,
          eventId: after.eventId,
          userId,
          qrCodeValue: regData.qrCodeValue,
          status: "pending",
          templateId: null,
          pdfURL: null,
          generatedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        didCreate = true;
      });

      if (didCreate) {
        logger.info("Badge creation triggered by payment success", {
          paymentId: event.data?.after?.id,
          registrationId: after.registrationId,
          badgeId,
        });
      }
    } catch (err) {
      logger.error("Failed to trigger badge generation after payment", err);
    }

    // ── Send payment success notification ──
    try {
      const eventDoc = await db.collection(COLLECTIONS.EVENTS).doc(after.eventId).get();
      const eventTitle = eventDoc.data()?.title ?? "l'événement";
      const userId =
        after.userId ??
        (await db.collection(COLLECTIONS.REGISTRATIONS).doc(after.registrationId).get()).data()
          ?.userId;

      if (!userId) {
        logger.warn("No userId found for payment success notification", {
          paymentId: event.data?.after?.id,
        });
        return;
      }

      // Create in-app notification
      await db.collection(COLLECTIONS.NOTIFICATIONS).add({
        userId,
        type: "payment_success",
        title: "Paiement confirmé",
        body: `Votre paiement pour ${eventTitle} a été confirmé. Votre badge est en cours de génération.`,
        data: {
          eventId: after.eventId,
          paymentId: event.data?.after?.id ?? "",
          registrationId: after.registrationId,
        },
        imageURL: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      });

      // Send FCM push if user has tokens
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      const fcmTokens: string[] = userDoc.data()?.fcmTokens ?? [];

      if (fcmTokens.length > 0) {
        await messaging.sendEachForMulticast({
          tokens: fcmTokens,
          notification: {
            title: "Paiement confirmé",
            body: `Votre paiement pour ${eventTitle} a été confirmé.`,
          },
          data: {
            type: "payment_success",
            eventId: after.eventId,
            paymentId: event.data?.after?.id ?? "",
          },
          android: { priority: "high" },
          apns: { payload: { aps: { sound: "default" } } },
        });
      }

      logger.info("Payment success notification sent", {
        paymentId: event.data?.after?.id,
        userId,
      });
    } catch (err) {
      logger.error("Failed to send payment success notification", err);
    }
  },
);

/**
 * When a payment fails, send a notification to the user suggesting retry.
 */
export const onPaymentFailed = onDocumentWritten(
  {
    document: `${COLLECTIONS.PAYMENTS}/{paymentId}`,
    region: "europe-west1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!after) return;

    const justFailed = before?.status !== "failed" && after.status === "failed";
    if (!justFailed) return;

    try {
      const eventDoc = await db.collection(COLLECTIONS.EVENTS).doc(after.eventId).get();
      const eventTitle = eventDoc.data()?.title ?? "l'événement";

      // Create in-app notification
      await db.collection(COLLECTIONS.NOTIFICATIONS).add({
        userId: after.userId,
        type: "payment_failed",
        title: "Paiement échoué",
        body: `Votre paiement pour ${eventTitle} n'a pas abouti. Vous pouvez réessayer.`,
        data: {
          eventId: after.eventId,
          paymentId: event.data?.after?.id ?? "",
        },
        imageURL: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      });

      // Send FCM push if user has tokens
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(after.userId).get();
      const fcmTokens: string[] = userDoc.data()?.fcmTokens ?? [];

      if (fcmTokens.length > 0) {
        await messaging.sendEachForMulticast({
          tokens: fcmTokens,
          notification: {
            title: "Paiement échoué",
            body: `Votre paiement pour ${eventTitle} a échoué. Vous pouvez réessayer.`,
          },
          data: {
            type: "payment_failed",
            eventId: after.eventId,
            paymentId: event.data?.after?.id ?? "",
          },
          android: { priority: "high" },
          apns: { payload: { aps: { sound: "default" } } },
        });
      }

      logger.info("Payment failure notification sent", {
        paymentId: event.data?.after?.id,
        userId: after.userId,
      });
    } catch (err) {
      logger.error("Failed to send payment failure notification", err);
    }
  },
);

/**
 * ADR-0018 / Phase 3 — Payments reconciliation cron.
 *
 * Complementary to `verifyAndFinalize` (frontend-driven) and
 * `onPaymentTimeout` (TTL safety net). Catches the case where:
 *   - the participant CLOSED the tab before redirect-back, so the
 *     verify-on-return path never fired; AND
 *   - the provider IPN didn't fire either (e.g. PayDunya sandbox
 *     flake).
 *
 * Schedule: every 10 minutes. Window: payments stuck in `processing`
 * with createdAt ∈ [now - 25 min, now - 5 min]. Outside that window:
 *   - newer than 5 min → too early; the IPN may still arrive.
 *   - older than 25 min → onPaymentTimeout will sweep them shortly
 *                          (default 30 min TTL) and flip to expired.
 *
 * Implementation: thin proxy to the API's `/v1/internal/payments/
 * reconcile` endpoint. The API service holds all the provider keys,
 * the ledger logic, the domain-event bus — duplicating that here
 * would split the source of truth. Same pattern as the existing
 * notification triggers (reminder / certificate / post-event) which
 * proxy to `/v1/internal/notifications/dispatch`.
 *
 * Auth: shared secret (`INTERNAL_DISPATCH_SECRET` env), same as the
 * dispatcher endpoint. Provisioned via `secrets-bootstrap.yml`.
 *
 * Idempotency: the API endpoint is idempotent per Payment (each
 * verify call short-circuits on terminal status). Even if Cloud
 * Scheduler fires twice on the same tick (rare), the duplicate
 * sweeps are no-ops.
 *
 * Timeout: Cloud Scheduler hard-caps at 540 s; we set 60 s here
 * because the API endpoint itself is bounded (max batch=50 × 2 s
 * worst-case provider RTT = 100 s, but each call is awaited and
 * the API's request-level rate limit caps total time).
 */
export const onPaymentReconciliation = onSchedule(
  {
    schedule: "every 10 minutes",
    region: "europe-west1",
    timeZone: "Africa/Dakar",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  // Env guard — staging + dev short-circuit with an INFO log. The same
  // job logic remains available via /admin/jobs (jobKey:
  // reconcile-payments) for manual triggering when an operator needs to
  // test the IPN recovery path without spinning a real cron.
  productionOnly("payment.reconciliation", logger, async () => {
    const apiBaseUrl = process.env.API_BASE_URL;
    const secret = process.env.INTERNAL_DISPATCH_SECRET;

    if (!apiBaseUrl || !secret) {
      logger.warn("payment.reconciliation: missing API_BASE_URL or INTERNAL_DISPATCH_SECRET", {
        hasUrl: Boolean(apiBaseUrl),
        hasSecret: Boolean(secret),
      });
      return;
    }

    const url = `${apiBaseUrl.replace(/\/$/, "")}/v1/internal/payments/reconcile`;

    // 90 s client-side timeout — bounded BELOW the Cloud Scheduler
    // 120 s function timeout to leave 30 s of headroom for log
    // emission on timeout. The API endpoint default-iterates 50
    // payments × ~2 s/provider RTT = ~100 s worst case, so a 60 s
    // client timeout would prematurely abort otherwise-successful
    // sweeps and log "timed out" while the API kept running and
    // emitted the success heartbeat — confusing audit records. 90 s
    // gives the API ~10 s to finalise on average while still cutting
    // off pathologically slow provider replies before they bleed
    // into the next cron tick.
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 90_000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Dispatch-Secret": secret,
        },
        // Empty body → API uses the configured defaults (windowMin=5min,
        // windowMax=25min, batch=50). Operators can adjust per-env via
        // a future override mechanism without redeploying this trigger.
        body: JSON.stringify({}),
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = JSON.parse(text);
      } catch {
        // non-JSON response (e.g. 502 from upstream) — log raw body bounded.
      }

      if (!response.ok) {
        logger.error("payment.reconciliation: API returned non-2xx", {
          status: response.status,
          body: text.slice(0, 1000),
        });
        return;
      }

      const stats = (payload as { data?: Record<string, number> })?.data;
      logger.info("payment.reconciliation: sweep complete", { stats });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        logger.error("payment.reconciliation: API call timed out (60s)");
      } else {
        logger.error("payment.reconciliation: API call failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }),
);
