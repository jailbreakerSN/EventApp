/**
 * Next 15 instrumentation hook — Wave 10 / W10-P1.
 *
 * Called once when the Next runtime boots (Node OR Edge). We dynamic-
 * import the matching Sentry config so the bundler doesn't pull
 * `@sentry/nextjs` Node integrations into the Edge bundle.
 *
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// In @sentry/nextjs v8.x the export is `captureRequestError`; Next 15
// looks for an export named `onRequestError` in instrumentation.ts —
// we re-export the SDK function under the expected name.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
