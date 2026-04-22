/**
 * Teranga Cloud Functions — entry point
 * Export all triggers here for Firebase deployment.
 */

// Global runtime options (region, maxInstances cap). MUST be first — ES module
// imports are hoisted in order, so this runs before any trigger module loads.
import "./options";

// ─── Auth Triggers ────────────────────────────────────────────────────────────
export { onUserCreated, onUserDeleted } from "./triggers/auth.triggers";

// ─── Badge Triggers ───────────────────────────────────────────────────────────
export { onBadgeCreated } from "./triggers/badge.triggers";

// ─── Registration Triggers (auto badge generation + waitlist promotion) ──────
export {
  onRegistrationCreated,
  onRegistrationApproved,
  onRegistrationCancelled,
} from "./triggers/registration.triggers";

// ─── Check-in Triggers ───────────────────────────────────────────────────────
export { onCheckinCompleted } from "./triggers/checkin.triggers";

// ─── Notification Triggers ────────────────────────────────────────────────────
export { onFeedPostCreated, onRegistrationConfirmed } from "./triggers/notification.triggers";

// ─── Payment Triggers ───────────────────────────────────────────────────────
export { onPaymentTimeout, onPaymentSucceeded, onPaymentFailed } from "./triggers/payment.triggers";

// ─── Scheduled Reminders ────────────────────────────────────────────────────
export { sendEventReminders, sendSessionReminders } from "./triggers/reminder.triggers";

// ─── Post-event feedback (Phase 2.3) ────────────────────────────────────────
// Runs every 15 minutes. For events that ended 2h ago, emits
// event.feedback_requested per checked-in attendee via the API's internal
// dispatch endpoint.
export { sendPostEventFollowups } from "./triggers/post-event.triggers";

// ─── Subscription lifecycle nudges (Phase 2.3) ─────────────────────────────
// Daily 09:00 Africa/Dakar. Emits subscription.expiring_soon (7 days out)
// and subscription.approaching_limit (>=80% of any usage cap).
export { sendSubscriptionReminders } from "./triggers/subscription-reminder.triggers";

// ─── Subscription Rollover (Phase 4c: honor prepaid periods) ────────────────
export { applySubscriptionRollovers } from "./triggers/subscription-rollover.triggers";

// ─── Retention Policy (Phase 3c.5) ──────────────────────────────────────────
// Daily 03:00 Africa/Dakar cleanup: pending newsletter subscribers >30d,
// email logs >90d. Suppression list + audit trail kept indefinitely.
export { runRetentionPolicies } from "./triggers/retention.triggers";

// ─── Resend Sync Layer (Phase 3b) ───────────────────────────────────────────
// Firestore ⇄ Resend: mirror newsletter subscribers into the Resend Segment,
// receive bounce/complaint/unsubscribe events, reconcile drift. Bootstrap is
// API-driven (callable), not dashboard-based — per resend-skills guidance.
export { bootstrapResendInfra } from "./triggers/resend/bootstrap-resend-infra.callable";
export { onNewsletterSubscriberCreated } from "./triggers/resend/on-subscriber-created.trigger";
export { onNewsletterSubscriberUpdated } from "./triggers/resend/on-subscriber-updated.trigger";
export { resendWebhook } from "./triggers/resend/resend-webhook.https";
export { reconcileResendSegment } from "./triggers/resend/reconcile-resend-segment.scheduled";

// ─── Notification Health Monitor (Phase 2.5) ────────────────────────────────
// Scheduled 10-min job: aggregates last-hour bounce / complaint rates per
// sending mailbox and writes alert docs + ERROR-level Cloud Logs when the
// rate exceeds platform thresholds (2% warn, 5% critical).
export { monitorBounceRate } from "./triggers/notification-health.triggers";
