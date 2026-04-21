import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { getResend, RESEND_API_KEY } from "../../utils/resend-client";
import { db, COLLECTIONS } from "../../utils/admin";
import { reconcilerOptions } from "../../utils/function-options";
import { getResendSystemConfig } from "./config-store";

// Observability-only reconciler. Runs every 6h, compares the set of active
// newsletterSubscribers in Firestore vs contacts in the Resend segment,
// and logs the delta.
//
// Does NOT auto-heal today — Phase 3c is where we'd backfill missing
// contacts + soft-deactivate Firestore rows for Resend-side unsubscribes
// that the webhook missed. Starting with observability lets operators
// see the drift pattern before we trust an automatic fix.

export const reconcileResendSegment = onSchedule(
  {
    ...reconcilerOptions(),
    schedule: "every 6 hours",
    timeZone: "Africa/Dakar",
    secrets: [RESEND_API_KEY],
  },
  async () => {
    const { newsletterSegmentId } = await getResendSystemConfig();
    if (!newsletterSegmentId) {
      logger.info("Reconciler skipped — segment not configured");
      return;
    }

    // ── Firestore side ──────────────────────────────────────────────────
    const firestoreSnap = await db
      .collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS)
      .where("isActive", "==", true)
      .get();
    const firestoreEmails = new Set(
      firestoreSnap.docs
        .map((d) => (d.data().email as string | undefined)?.toLowerCase())
        .filter((e): e is string => !!e),
    );

    // ── Resend side ─────────────────────────────────────────────────────
    // The SDK's contacts.list supports segmentId filter + pagination. For
    // the volumes we project in 2026 (low four figures) one call is
    // plenty; if we need pagination later, loop on the `next` cursor.
    const resendList = await getResend().contacts.list({ segmentId: newsletterSegmentId });
    if (resendList.error) {
      logger.error("Resend contacts.list failed", { error: resendList.error });
      throw new Error(`Resend contacts.list: ${resendList.error.message}`);
    }
    type ResendContact = { email: string; unsubscribed?: boolean };
    const resendContacts = (resendList.data as { data?: ResendContact[] } | null)?.data ?? [];
    const resendActive = new Set(
      resendContacts.filter((c) => !c.unsubscribed).map((c) => c.email.toLowerCase()),
    );
    const resendUnsubscribed = new Set(
      resendContacts.filter((c) => c.unsubscribed).map((c) => c.email.toLowerCase()),
    );

    // ── Drift ───────────────────────────────────────────────────────────
    const inFirestoreNotResend = [...firestoreEmails].filter((e) => !resendActive.has(e));
    const inResendNotFirestore = [...resendActive].filter((e) => !firestoreEmails.has(e));
    const resendUnsubYetFirestoreActive = [...resendUnsubscribed].filter((e) =>
      firestoreEmails.has(e),
    );

    logger.info("Resend segment reconciliation", {
      firestoreActive: firestoreEmails.size,
      resendActive: resendActive.size,
      resendUnsubscribed: resendUnsubscribed.size,
      drift: {
        inFirestoreNotResend: inFirestoreNotResend.length,
        inResendNotFirestore: inResendNotFirestore.length,
        resendUnsubYetFirestoreActive: resendUnsubYetFirestoreActive.length,
      },
      // Sample up to 10 emails per category so log output stays bounded.
      samples: {
        missingMirror: inFirestoreNotResend.slice(0, 10),
        orphansInResend: inResendNotFirestore.slice(0, 10),
        missedWebhook: resendUnsubYetFirestoreActive.slice(0, 10),
      },
    });
  },
);
