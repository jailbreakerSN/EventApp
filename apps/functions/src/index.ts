/**
 * Teranga Cloud Functions — entry point
 * Export all triggers here for Firebase deployment.
 */

// ─── Auth Triggers ────────────────────────────────────────────────────────────
export { onUserCreated, onUserDeleted } from "./triggers/auth.triggers";

// ─── Badge Triggers ───────────────────────────────────────────────────────────
export { onBadgeCreated } from "./triggers/badge.triggers";

// ─── Registration Triggers (auto badge generation) ───────────────────────────
export { onRegistrationCreated, onRegistrationApproved } from "./triggers/registration.triggers";

// ─── Notification Triggers ────────────────────────────────────────────────────
export { onFeedPostCreated, onRegistrationConfirmed } from "./triggers/notification.triggers";
