// Dictionary shape + picker. Every locale file must satisfy `Dictionary` —
// that's how we enforce translation completeness at compile time. Strings
// stay in TS (not JSON) so we keep interpolation as typed functions and let
// `tsc` yell when a new key is missing in `en.ts` or `wo.ts`.
//
// French is the source of truth; unknown or missing locales fall back to fr.

export type Locale = "fr" | "en" | "wo";

export interface Dictionary {
  /**
   * BCP-47 locale code for this dictionary — rendered into `<Html lang>`
   * by EmailLayout so screen readers + mail clients tag the body with
   * the right language. Must match the Locale key used in
   * `i18n/index.ts#pickDict` so en / wo emails don't render as French
   * to assistive tech.
   */
  lang: Locale;
  brand: {
    tagline: string;
    footer: string;
  };
  common: {
    greeting: (name: string) => string;
    signoff: string;
    viewInApp: string;
  };
  registrationConfirmation: {
    subject: (eventTitle: string) => string;
    preview: (eventTitle: string) => string;
    heading: string;
    body: (eventTitle: string) => string;
    dateLabel: string;
    locationLabel: string;
    ticketLabel: string;
    downloadBadgeCta: string;
    badgeInAppHint: string;
  };
  registrationApproved: {
    subject: (eventTitle: string) => string;
    preview: string;
    heading: string;
    body: (eventTitle: string) => string;
    dateLabel: string;
    locationLabel: string;
    downloadBadgeCta: string;
    badgeInAppHint: string;
  };
  badgeReady: {
    subject: (eventTitle: string) => string;
    preview: string;
    heading: string;
    body: (eventTitle: string) => string;
    downloadBadgeCta: string;
    badgeInAppHint: string;
  };
  eventReminder: {
    subject: (eventTitle: string, timeUntil: string) => string;
    preview: (eventTitle: string) => string;
    heading: (timeUntil: string) => string;
    body: (eventTitle: string, timeUntil: string) => string;
    dateLabel: string;
    locationLabel: string;
    dontForgetBadge: string;
  };
  eventCancelled: {
    subject: (eventTitle: string) => string;
    preview: string;
    heading: string;
    body: (eventTitle: string, eventDate: string) => string;
    contactOrganizer: string;
  };
  paymentReceipt: {
    subject: (amount: string) => string;
    preview: (amount: string) => string;
    heading: string;
    body: (amount: string, eventTitle: string) => string;
    amountLabel: string;
    eventLabel: string;
    receiptIdLabel: string;
    dateLabel: string;
    thankYou: string;
  };
  welcomeNewsletter: {
    subject: string;
    preview: string;
    heading: string;
    body: string;
    closing: string;
    unsubscribeNote: string;
    /**
     * Visible anchor text for the in-body unsubscribe link on broadcasts.
     * Paired with `{{{RESEND_UNSUBSCRIBE_URL}}}` at render time — Resend
     * substitutes a per-recipient URL. Kept separate from `unsubscribeNote`
     * so the sentence can change independently of the link text.
     */
    unsubscribeLinkLabel: string;
  };
  newsletterConfirmation: {
    subject: string;
    preview: string;
    heading: string;
    body: string;
    ctaButton: string;
    /** Shown below the CTA — e.g. "This link expires in 7 days." */
    expiryNote: string;
    /** Shown for recipients who didn't initiate the signup. */
    didNotSubscribeNote: string;
    /** Plain-text fallback line with the raw URL, in case the button is stripped. */
    fallbackLine: (url: string) => string;
  };
  // ─── Auth: verify email ─────────────────────────────────────────────────
  // Firebase-hosted verification email replacement. Sent via Resend by
  // apps/api/src/services/auth-email.service.ts instead of Firebase's
  // default template, so the From header, DMARC alignment, tracking, and
  // landing page all stay on the Teranga brand. Link points at the
  // participant / backoffice web app's /auth/action handler.
  emailVerification: {
    subject: string;
    preview: string;
    heading: (name: string) => string;
    body: string;
    ctaButton: string;
    /** One-line expiry notice beneath the CTA. Firebase action codes live 1 hour. */
    expiryNote: string;
    /** Safety paragraph shown to non-initiators. */
    didNotRequestNote: string;
    /** Plain-text fallback line with the raw URL. */
    fallbackLine: (url: string) => string;
  };
  // ─── Auth: password reset ───────────────────────────────────────────────
  // Same pattern as emailVerification but for the "forgot my password"
  // flow. Body copy is deliberately cautious — this email is the prime
  // target of a phishing clone, so the safety note is first-class copy.
  passwordReset: {
    subject: string;
    preview: string;
    heading: string;
    body: string;
    ctaButton: string;
    expiryNote: string;
    /**
     * Security-critical note shown in a warning box. Users who didn't
     * request a reset need to see this before they'd click anything.
     */
    didNotRequestNote: string;
    fallbackLine: (url: string) => string;
  };
}
