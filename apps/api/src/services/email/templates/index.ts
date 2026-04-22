// Barrel — stable import surface for the rest of the API.
// Each template file ships an async `build*` function that returns
// { subject, html, text }. Existing callers import from here; the old inline
// HTML in providers/index.ts has been retired.

export { buildRegistrationEmail } from "./registration-confirmation";
export type { RegistrationConfirmationParams } from "./registration-confirmation";

export { buildRegistrationApprovedEmail } from "./registration-approved";
export type { RegistrationApprovedParams } from "./registration-approved";

export { buildBadgeReadyEmail } from "./badge-ready";
export type { BadgeReadyParams } from "./badge-ready";

export { buildEventReminderEmail } from "./event-reminder";
export type { EventReminderParams } from "./event-reminder";

export { buildEventCancelledEmail } from "./event-cancelled";
export type { EventCancelledParams } from "./event-cancelled";

export { buildWelcomeEmail } from "./welcome-newsletter";
export type { WelcomeNewsletterParams } from "./welcome-newsletter";

export { buildPaymentReceiptEmail } from "./payment-receipt";
export type { PaymentReceiptParams } from "./payment-receipt";

export { buildNewsletterConfirmationEmail } from "./newsletter-confirmation";
export type { NewsletterConfirmationParams } from "./newsletter-confirmation";

export { buildEmailVerificationEmail } from "./email-verification";
export type { EmailVerificationParams } from "./email-verification";

export { buildPasswordResetEmail } from "./password-reset";
export type { PasswordResetParams } from "./password-reset";

// ─── Phase 2 notifications ────────────────────────────────────────────────

export { buildPaymentFailedEmail } from "./payment-failed";
export type { PaymentFailedParams } from "./payment-failed";

export { buildInviteSentEmail } from "./invite-sent";
export type { InviteSentParams } from "./invite-sent";

export { buildRegistrationCancelledEmail } from "./registration-cancelled";
export type { RegistrationCancelledParams } from "./registration-cancelled";

export { buildEventRescheduledEmail } from "./event-rescheduled";
export type { EventRescheduledParams } from "./event-rescheduled";

export { buildWaitlistPromotedEmail } from "./waitlist-promoted";
export type { WaitlistPromotedParams } from "./waitlist-promoted";

export { buildRefundIssuedEmail } from "./refund-issued";
export type { RefundIssuedParams } from "./refund-issued";

export { buildRefundFailedEmail } from "./refund-failed";
export type { RefundFailedParams } from "./refund-failed";

export { buildMemberUpdateEmail } from "./member-update";
export type { MemberUpdateParams } from "./member-update";

export { buildSpeakerAddedEmail } from "./speaker-added";
export type { SpeakerAddedParams } from "./speaker-added";

export { buildSponsorAddedEmail } from "./sponsor-added";
export type { SponsorAddedParams } from "./sponsor-added";

export { buildSubscriptionChangeEmail } from "./subscription-change";
export type { SubscriptionChangeParams } from "./subscription-change";

export { buildPayoutCreatedEmail } from "./payout-created";
export type { PayoutCreatedParams } from "./payout-created";

export { buildPlatformWelcomeEmail } from "./welcome";
export type { WelcomeParams } from "./welcome";

export { buildPasswordChangedEmail } from "./password-changed";
export type { PasswordChangedParams } from "./password-changed";

export { buildEmailChangedEmail } from "./email-changed";
export type { EmailChangedParams } from "./email-changed";

export { buildSubscriptionPastDueEmail } from "./subscription-past-due";
export type { SubscriptionPastDueParams } from "./subscription-past-due";

export type { RenderedEmail } from "../render";
