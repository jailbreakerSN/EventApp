/**
 * Wave 10 / W10-P1 — frontend Sentry on the backoffice (Next.js server runtime).
 *
 * Loaded automatically by `withSentryConfig` in `next.config.ts`. Runs
 * in the Node runtime when Next renders RSC / SSR / route handlers /
 * server actions.
 *
 * Same posture as the API's `apps/api/src/observability/sentry.ts`:
 *   - 5xx-only filter via `beforeSend` so 4xx noise doesn't fill the
 *     issue stream,
 *   - `sendDefaultPii: false`,
 *   - 10 % sampling.
 *
 * DSN sourcing — supports both `SENTRY_DSN` (server-side) and
 * `NEXT_PUBLIC_SENTRY_DSN` (browser). Server-only DSN is preferred so
 * the secret never lands in the client bundle.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event, hint) {
      const error = hint.originalException as { statusCode?: number } | undefined;
      if (error?.statusCode && error.statusCode < 500) return null;
      return event;
    },
  });
}
