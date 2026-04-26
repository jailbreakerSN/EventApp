/**
 * Wave 10 / W10-P1 — frontend Sentry on the backoffice (Edge runtime).
 *
 * Loaded by `withSentryConfig` in `next.config.ts` for Edge route
 * handlers + middleware. The Edge runtime is a constrained subset of
 * Node, so the SDK ships fewer integrations — keep this config lean.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
