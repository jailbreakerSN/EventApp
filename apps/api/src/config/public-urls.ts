import { config } from "@/config";

// ─── Public URL builders — the single source of truth ────────────────────
//
// Every absolute URL we hand to an external system (email recipients,
// payment providers, webhook senders) flows through this module. Three
// reasons:
//
//   1. Domain changes are config-only. Swapping terangaevent.com for a
//      new domain means updating three env vars (API_BASE_URL,
//      PARTICIPANT_WEB_URL, WEB_BACKOFFICE_URL) in Cloud Run and nothing
//      else — no grep-and-replace across services and templates, no
//      forgotten string-template leak that still points at the old host.
//
//   2. Consistent encoding. Every path segment that embeds user-
//      controlled data (tokens, ids) is `encodeURIComponent`-ed here.
//      Call sites can't forget, and the test suite only has to cover
//      one encoding path.
//
//   3. Grep-able routes. When we rename a route (e.g. /v1/newsletter/
//      confirm → /v1/subscriptions/confirm), exactly one change in this
//      file propagates everywhere the URL is produced.
//
// NOT in scope:
//   - Links the web apps themselves render (those live in the Next.js
//     apps' own configs).
//   - Internal service-to-service calls (those use Cloud Run's
//     service:region hostnames, not public URLs).

/** Build the newsletter double-opt-in confirmation URL shipped by email. */
export function newsletterConfirmUrl(token: string): string {
  return `${config.API_BASE_URL}/v1/newsletter/confirm?token=${encodeURIComponent(token)}`;
}

/** Build the subscriber-facing unsubscribe URL (List-Unsubscribe header + visible link). */
export function unsubscribeUrl(token: string): string {
  return `${config.API_BASE_URL}/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Build the payment-provider webhook callback URL (method = "wave", "orange", "mock", ...). */
export function paymentWebhookUrl(method: string): string {
  return `${config.API_BASE_URL}/v1/payments/webhook/${encodeURIComponent(method)}`;
}

/** Build the default post-payment return URL on the participant web app. */
export function paymentReturnUrl(eventId: string, paymentId: string): string {
  return (
    `${config.PARTICIPANT_WEB_URL}/register/${encodeURIComponent(eventId)}` +
    `/payment-status?paymentId=${encodeURIComponent(paymentId)}`
  );
}

/** Build the mock checkout redirect URL (dev / staging only; serves an HTML page on the API). */
export function paymentMockCheckoutUrl(providerTransactionId: string): string {
  return `${config.API_BASE_URL}/v1/payments/mock-checkout/${encodeURIComponent(providerTransactionId)}`;
}

// ─── Auth action landing URL (Firebase Auth OOB handler) ─────────────────
//
// Fed into actionCodeSettings.url when we call admin.auth().
// generateEmailVerificationLink() / generatePasswordResetLink(). Firebase
// appends `mode=verifyEmail|resetPassword&oobCode=...&apiKey=...` to this
// URL; the landing page calls the Firebase Client SDK
// (applyActionCode / confirmPasswordReset) with the code.
//
// Two apps, two audiences:
//   - participant signups land on the participant web app.
//   - backoffice signups land on the backoffice web app.
// The caller picks via `audience`.

export type AuthActionAudience = "participant" | "backoffice";

export function authActionUrl(audience: AuthActionAudience): string {
  const base = audience === "backoffice" ? config.WEB_BACKOFFICE_URL : config.PARTICIPANT_WEB_URL;
  return `${base}/auth/action`;
}

/**
 * Hosts the platform itself owns — used by the payment returnUrl
 * allowlist to prevent open-redirect abuse on the back of a trusted
 * Wave / Orange Money redirect. Pulled from the typed config so a
 * domain change automatically propagates here too.
 *
 * Dev also accepts the three local dev ports so emulator flows work
 * without every developer configuring ALLOWED_RETURN_HOSTS by hand.
 */
export function getOwnedWebHosts(): string[] {
  const hosts: string[] = [];
  for (const url of [config.PARTICIPANT_WEB_URL, config.WEB_BACKOFFICE_URL]) {
    try {
      hosts.push(new URL(url).host.toLowerCase());
    } catch {
      // Unreachable — Zod already validates these as URLs at boot.
    }
  }
  return hosts;
}
