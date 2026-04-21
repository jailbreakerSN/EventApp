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

export type { RenderedEmail } from "../render";
