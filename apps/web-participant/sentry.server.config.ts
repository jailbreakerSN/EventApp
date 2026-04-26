/**
 * Wave 10 / W10-P1 — frontend Sentry on the participant app (Node runtime).
 *
 * Mirror of `apps/web-backoffice/sentry.server.config.ts`. SSR / RSC /
 * route-handler errors land here. 5xx-only filter to keep the issue
 * stream actionable.
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
