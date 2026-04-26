/**
 * Wave 10 / W10-P1 — frontend Sentry on the participant app (browser).
 *
 * Mirrors `apps/web-backoffice/sentry.client.config.ts`. The participant
 * app is the public surface (event discovery, registration, badges) and
 * runs on flaky African networks — Web Vitals capture is the main use
 * case, second to error tracking.
 *
 * `replaysSessionSampleRate: 0.05` — light session replay sampling for
 * the public funnel where reproducing client-side bugs is hardest.
 * Errors trigger 100 % replay capture for the surrounding 60 s window.
 *
 * The `use-error-handler` hook (`src/hooks/use-error-handler.ts`)
 * pipes mutation failures here via `Sentry.captureException`.
 */

import * as Sentry from "@sentry/nextjs";
import { setErrorReporter } from "@teranga/shared-types";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// W10-P6 / L4 — Senegal Loi 2008-12 + GDPR alignment. Sentry is
// observability tracking + (eventually) session replay; we treat it
// as a non-essential cookie and gate init on user consent. The
// CookieConsentBanner persists the choice in localStorage under
// `teranga_cookie_consent_v1`; if it's absent or "rejected", we hold
// off on init. The consent banner broadcasts a `teranga:cookie-
// consent` CustomEvent on accept so we can lazily init without a
// page reload.
function hasCookieConsent(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("teranga_cookie_consent_v1") === "accepted";
}

function init() {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // ⚠ Session Replay is intentionally NOT enabled. The participant
    // app handles registration flows that surface name / email / phone
    // / payment details; activating Replay without `maskAllInputs:
    // true` + `blockAllMedia: true` would ship form contents to Sentry.
    // Setting `replays*SampleRate` here today would be inert (no
    // `replayIntegration()` in `integrations`), but documenting the
    // rationale prevents a future contributor from adding the
    // integration with insecure defaults. Wave 10 follow-up: introduce
    // Replay only after a PII-mask + consent-banner audit ships.
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
    ],
  });

  // W10-P1 — wire `useErrorHandler`'s reporter slot (registered in
  // `@teranga/shared-types/error-reporter`) to Sentry. Every
  // mutation failure that the hook resolves now lands in Sentry with
  // structured tags (`error.code`, `error.reason`, `error.status`) so
  // the issue stream is filterable by error class instead of stack.
  setErrorReporter((error, descriptor) => {
    Sentry.withScope((scope) => {
      scope.setTag("error.code", descriptor.code);
      if (descriptor.reason) scope.setTag("error.reason", descriptor.reason);
      if (descriptor.status !== undefined) scope.setTag("error.status", String(descriptor.status));
      Sentry.captureException(error);
    });
  });
}

if (typeof window !== "undefined" && dsn) {
  if (hasCookieConsent()) {
    init();
  } else {
    // Lazy-init on user consent so the SDK never loads for users who
    // declined. The banner dispatches `teranga:cookie-consent` with
    // detail = "accepted" | "rejected" — we only act on accept.
    const onConsent = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === "accepted") {
        init();
        window.removeEventListener("teranga:cookie-consent", onConsent);
      }
    };
    window.addEventListener("teranga:cookie-consent", onConsent);
  }
}
