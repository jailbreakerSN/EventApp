/**
 * Wave 10 / W10-P1 — frontend Sentry on the backoffice (browser).
 *
 * Loaded automatically by `withSentryConfig` in `next.config.ts`. Runs
 * in the browser after the page hydrates. Never imports anything that
 * touches Node APIs.
 *
 * Posture (mirrors the API):
 *   - 5xx-only filter is server-side concern; the browser SDK
 *     captures any uncaught exception OR unhandled promise rejection.
 *   - `sendDefaultPii: false` — we don't ship the user email or IP by
 *     default. Per-request user attribution lands via `Sentry.setUser`
 *     after auth (see `src/lib/sentry-user.ts`).
 *   - Performance sampling at 10 % to keep the SDK budget honest.
 *   - Replay disabled — the backoffice carries org-scoped PII and we
 *     want to opt in deliberately, not by default.
 *   - DSN comes from `NEXT_PUBLIC_SENTRY_DSN`. When unset (local
 *     dev / unconfigured deploys) the SDK no-ops and call sites stay
 *     valid.
 */

import * as Sentry from "@sentry/nextjs";
import { setErrorReporter } from "@teranga/shared-types";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
    ],
  });

  // W10-P1 — register Sentry as the error reporter consumed by
  // `useErrorHandler` (shared-types `error-reporter` registry). Every
  // hook-resolved mutation failure lands in Sentry tagged by
  // `error.code` / `error.reason` / `error.status`.
  setErrorReporter((error, descriptor) => {
    Sentry.withScope((scope) => {
      scope.setTag("error.code", descriptor.code);
      if (descriptor.reason) scope.setTag("error.reason", descriptor.reason);
      if (descriptor.status !== undefined) scope.setTag("error.status", String(descriptor.status));
      Sentry.captureException(error);
    });
  });
}
