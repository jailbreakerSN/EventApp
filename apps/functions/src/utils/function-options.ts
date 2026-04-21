// Shared function runtime options. Staging defaults to cost-minimal
// (minInstances: 0, 256MiB); production (detected by GCLOUD_PROJECT) bumps
// to 512MiB + warms one instance to hide cold-start latency on the webhook
// path.
//
// Why the 256MiB floor (not 128): Firebase Functions v2 runs each function
// as its own Cloud Run revision. The container must bind to PORT=8080
// within ~30s of boot or the deploy fails the healthcheck. With
// firebase-admin + the Resend SDK + the Google trigger wrapper all loaded
// at module-init time, 128MiB OOMs during startup (observed on the
// 2026-04-21 staging deploy: onNewsletterSubscriberUpdated failed with
// "The user-provided container failed to start and listen on the port
// defined provided by the PORT=8080 environment variable within the
// allocated timeout"). 256MiB is the practical minimum for any Node.js
// function that imports firebase-admin; it matches what Google's own
// Firestore-trigger template ships with.
//
// When prod tuning proves a given function needs more, adjust the table
// below — single place to touch.

const IS_PROD = process.env.GCLOUD_PROJECT === "teranga-events-prod";

const REGION = "europe-west1" as const;

/**
 * Minimal Firestore / HTTPS trigger options.
 * - Staging: 256 MiB, cold-start OK (Resend retries on 5xx).
 * - Prod: 512 MiB + 1 warm instance.
 */
export function minimalOptions(opts: { maxInstances: number }): {
  region: typeof REGION;
  memory: "256MiB" | "512MiB";
  minInstances: 0 | 1;
  maxInstances: number;
} {
  return {
    region: REGION,
    memory: IS_PROD ? "512MiB" : "256MiB",
    minInstances: IS_PROD ? 1 : 0,
    maxInstances: IS_PROD ? 100 : opts.maxInstances,
  };
}

/**
 * Scheduled reconciliation jobs. Always cold-start — batch work doesn't
 * need warm instances. A bit of extra RAM because paginated list iteration
 * plus set math can spike on large audiences.
 */
export function reconcilerOptions(): {
  region: typeof REGION;
  memory: "256MiB" | "512MiB";
  minInstances: 0;
  maxInstances: 1;
} {
  return {
    region: REGION,
    memory: IS_PROD ? "512MiB" : "256MiB",
    minInstances: 0,
    maxInstances: 1,
  };
}
