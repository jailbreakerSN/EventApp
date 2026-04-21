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
