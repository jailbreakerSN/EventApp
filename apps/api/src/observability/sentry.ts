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

/**
 * W10-P1 — outbound dependency tracing.
 *
 * Wraps a callback in a Sentry span so the operation shows up as a
 * child of the parent request transaction in distributed traces. We
 * use this for Firestore reads (the dominant latency source) and for
 * outbound HTTP that v8's auto-instrumentation can't see (e.g. wrapped
 * helpers, channel adapters, PDF generation).
 *
 * When Sentry isn't initialized OR no parent transaction exists, the
 * callback runs unchanged — no overhead, no broken traces.
 *
 * Usage:
 *
 *     return withSpan({ op: "db.firestore", name: "events.findById" }, async () => {
 *       return docRef.get();
 *     });
 *
 * Conventions for `op`:
 *   - "db.firestore"  — any Firestore operation
 *   - "http.client"   — outbound HTTP we wrap manually
 *   - "channel.send"  — notification dispatcher channel adapters
 *   - "pdf.render"    — pdf-lib + canvas badge / receipt rendering
 *
 * Conventions for `name`:
 *   - "<resource>.<verb>" — `events.findById`, `users.batchGet`, etc.
 */
type SpanAttribute = string | number | boolean;

export async function withSpan<T>(
  options: { op: string; name: string; data?: Record<string, SpanAttribute> },
  callback: () => Promise<T>,
): Promise<T> {
  if (!initialized) return callback();
  return Sentry.startSpan(
    { op: options.op, name: options.name, attributes: options.data },
    async () => callback(),
  );
}

/**
 * Set the current request's user context on Sentry's scope so future
 * `captureException` calls within this request are attributed to the
 * caller. Wired from the auth middleware after token verification.
 *
 * Cross-tenant safety
 * ───────────────────
 * Cloud Run handles many concurrent requests in a single Node process.
 * Writing via `Sentry.setUser()` / `Sentry.setTag()` would land on the
 * GLOBAL scope and bleed between concurrent requests — Request A's
 * `organizationId` could end up tagging Request B's exception.
 *
 * Instead we write to `Sentry.getIsolationScope()` which Sentry's
 * httpIntegration scopes per-async-context (per HTTP request). Each
 * incoming Fastify request gets its own isolation scope at handler
 * entry, so user + org attribution stays request-local.
 *
 * `sendDefaultPii: false` is set globally — only the uid is sent,
 * never the email or IP. Override per-deploy via env if PII
 * attribution is needed for debugging.
 */
export function setSentryUser(user: { uid: string; organizationId?: string | null }): void {
  if (!initialized) return;
  const scope = Sentry.getIsolationScope();
  scope.setUser({ id: user.uid });
  if (user.organizationId) {
    scope.setTag("organizationId", user.organizationId);
  }
}
