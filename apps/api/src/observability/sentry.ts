import * as Sentry from "@sentry/node";
import { config } from "@/config/index";

/**
 * Sentry is optional. When SENTRY_DSN is unset (local dev, CI, unconfigured
 * environments) every exported helper is a no-op — call sites never need to
 * null-check the DSN themselves.
 */

let initialized = false;

/**
 * Initialize Sentry. Must be called BEFORE buildApp() so Node SDK v8's
 * auto-instrumentation can hook into outgoing HTTP and fs calls before
 * Fastify or firebase-admin load them.
 */
export function initSentry(): void {
  if (initialized) return;
  if (!config.SENTRY_DSN) return;

  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    // Conservative performance sampling — 10% of traces. Tune via env later
    // if we need more or less granularity.
    tracesSampleRate: 0.1,
    // Don't ship IP addresses or user emails by default. Enable selectively
    // when we add user scope via setUser() after auth.
    sendDefaultPii: false,
    // Drop noisy Fastify 4xx client errors — only 5xx hit Sentry.
    beforeSend(event, hint) {
      const error = hint.originalException as { statusCode?: number } | undefined;
      if (error?.statusCode && error.statusCode < 500) return null;
      return event;
    },
  });
  initialized = true;
}

/**
 * Report an exception to Sentry with optional structured context (request
 * id, userId, route). No-op when Sentry is not initialized.
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/**
 * Flush pending Sentry events with a timeout. Call during graceful shutdown
 * so SIGTERM doesn't drop in-flight error reports.
 */
export async function closeSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.close(timeoutMs);
}

export function isSentryEnabled(): boolean {
  return initialized;
}
