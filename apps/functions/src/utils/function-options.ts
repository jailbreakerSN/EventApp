// Shared function runtime options. Staging defaults to cost-minimal
// (minInstances: 0, 128MiB); production (detected by GCLOUD_PROJECT) bumps
// RAM + warms one instance to hide cold-start latency on the webhook path.
//
// When prod tuning proves a given function needs more, adjust the table
// below — single place to touch.

const IS_PROD = process.env.GCLOUD_PROJECT === "teranga-events-prod";

const REGION = "europe-west1" as const;

/**
 * Minimal Firestore / HTTPS trigger options.
 * - Staging: 128 MiB, cold-start OK (Resend retries on 5xx).
 * - Prod: 256 MiB + 1 warm instance.
 */
export function minimalOptions(opts: { maxInstances: number }): {
  region: typeof REGION;
  memory: "128MiB" | "256MiB";
  minInstances: 0 | 1;
  maxInstances: number;
} {
  return {
    region: REGION,
    memory: IS_PROD ? "256MiB" : "128MiB",
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
