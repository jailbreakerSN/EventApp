import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db, messaging, COLLECTIONS } from "../utils/admin";

/**
 * Payment timeout: cancels pending payments that haven't completed within 30 minutes.
 * Runs every 5 minutes.
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
    const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    const cutoff = new Date(Date.now() - TIMEOUT_MS).toISOString();

    const pendingPayments = await db
      .collection(COLLECTIONS.PAYMENTS)
      .where("status", "==", "processing")
      .where("createdAt", "<", cutoff)
      .limit(100)
      .get();

    if (pendingPayments.empty) return;

    const now = new Date().toISOString();
    let cancelled = 0;

    // Process in batches of 490 (Firestore batch limit is 500)
    const docs = pendingPayments.docs;
    for (let i = 0; i < docs.length; i += 490) {
      const chunk = docs.slice(i, i + 490);
      const batch = db.batch();

      for (const doc of chunk) {
        const payment = doc.data();

        // Cancel payment
        batch.update(doc.ref, {
          status: "failed",
          failureReason: "Délai de paiement expiré (30 min)",
          updatedAt: now,
        });

        // Cancel associated registration
        const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(payment.registrationId);
        batch.update(regRef, {
          status: "cancelled",
          updatedAt: now,
        });

        cancelled++;
      }

      await batch.commit();
    }

    if (cancelled > 0) {
      logger.info(`Payment timeout: cancelled ${cancelled} expired payments`, {
        cutoff,
        cancelled,
      });
    }
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

      // Atomic duplicate check + create inside a transaction. Previously
      // this was a check-then-set pair of separate operations: two
      // concurrent fires (API event-bus emit + Firestore payment-status
      // trigger both reacting to the same payment.succeeded) could both
      // pass the `existingBadge.empty` check and both call `set()`,
      // producing two badge docs for one registration. The transaction
      // forces the second caller to observe the first's write and skip.
      //
      // Mirrors the pattern already used by registration.triggers.ts:213
      // so the two badge-creation paths (payment-completed and
      // registration-confirmed for free events) stay safe against the
      // same class of race.
      const badgeRef = db.collection(COLLECTIONS.BADGES).doc();
      let createdBadgeId: string | null = null;
      await db.runTransaction(async (tx) => {
        const existingBadge = await tx.get(
          db
            .collection(COLLECTIONS.BADGES)
            .where("registrationId", "==", after.registrationId)
            .limit(1),
        );

        if (!existingBadge.empty) {
          logger.info("Badge already exists for registration, skipping", {
            registrationId: after.registrationId,
          });
          return;
        }

        tx.set(badgeRef, {
          id: badgeRef.id,
          registrationId: after.registrationId,
          eventId: after.eventId,
          userId: after.userId ?? regData.userId,
          qrCodeValue: regData.qrCodeValue,
          status: "pending",
          templateId: null,
          pdfURL: null,
          generatedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        createdBadgeId = badgeRef.id;
      });

      if (createdBadgeId) {
        logger.info("Badge creation triggered by payment success", {
          paymentId: event.data?.after?.id,
          registrationId: after.registrationId,
          badgeId: createdBadgeId,
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
