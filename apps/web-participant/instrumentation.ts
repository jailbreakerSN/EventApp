/**
 * Next 15 instrumentation hook — Wave 10 / W10-P1.
 *
 * Boots the Sentry SDK for the Node runtime + the Edge runtime via
 * dynamic import so each runtime only pulls its own SDK surface.
 *
 * `onRequestError` is re-exported from `@sentry/nextjs` so the Next
 * runtime forwards uncaught request errors to Sentry without a
 * separate hook in every route handler.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// See web-backoffice instrumentation.ts — Sentry v8 exports
// `captureRequestError`; Next 15 expects `onRequestError`.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
