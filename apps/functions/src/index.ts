/**
 * Teranga Cloud Functions — entry point
 * Export all triggers here for Firebase deployment.
 */

// ─── Auth Triggers ────────────────────────────────────────────────────────────
export { onUserCreated, onUserDeleted } from "./triggers/auth.triggers";

// ─── Badge Triggers ───────────────────────────────────────────────────────────
export { onBadgeCreated } from "./triggers/badge.triggers";

// ─── Registration Triggers (auto badge generation + waitlist promotion) ──────
export { onRegistrationCreated, onRegistrationApproved, onRegistrationCancelled } from "./triggers/registration.triggers";

// ─── Check-in Triggers ───────────────────────────────────────────────────────
export { onCheckinCompleted } from "./triggers/checkin.triggers";

// ─── Notification Triggers ────────────────────────────────────────────────────
export { onFeedPostCreated, onRegistrationConfirmed } from "./triggers/notification.triggers";

// ─── Payment Triggers ───────────────────────────────────────────────────────
export { onPaymentTimeout, onPaymentSucceeded, onPaymentFailed } from "./triggers/payment.triggers";

// ─── Scheduled Reminders ────────────────────────────────────────────────────
export { sendEventReminders, sendSessionReminders } from "./triggers/reminder.triggers";
