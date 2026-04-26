// ─── Environment detection for Cloud Functions ──────────────────────────────
//
// Single source of truth for "should this scheduled job actually run?" in
// Cloud Functions. Detection is project-id based (not a separate env var):
//
//   GCLOUD_PROJECT === "teranga-events-prod"  →  production
//   GCLOUD_PROJECT === "teranga-app-990a8"    →  staging (shared with default)
//   anything else                              →  development
//
// Why project-id and not a custom `TERANGA_ENV`:
//   - Already set by the Firebase runtime; zero deploy-time configuration.
//   - Mirrors `apps/functions/src/utils/function-options.ts:21`'s
//     `IS_PROD = process.env.GCLOUD_PROJECT === "teranga-events-prod"`,
//     which Wave 10 standardised on.
//   - A missing GCLOUD_PROJECT (local emulator / unit test) is treated as
//     non-prod, which is the safe default — staging cron suppressions
//     don't run in dev either.
//
// Tests can override via vi.stubEnv("GCLOUD_PROJECT", "...") — see
// apps/functions/src/utils/__tests__/env.test.ts.

export type TerangaEnv = "production" | "staging" | "development";

export function getTerangaEnv(): TerangaEnv {
  const projectId = process.env.GCLOUD_PROJECT;
  if (projectId === "teranga-events-prod") return "production";
  if (projectId === "teranga-app-990a8") return "staging";
  return "development";
}

export function isProduction(): boolean {
  return getTerangaEnv() === "production";
}

/**
 * Policy gate for scheduled jobs that should ONLY auto-fire in production.
 *
 * Today's set: `releaseAvailableFunds` (financial settlement),
 * `onPaymentReconciliation` (provider state sync). In staging + dev, the
 * cron handler short-circuits with an INFO log; the same job logic
 * remains available via the admin /admin/jobs UI for manual triggering.
 *
 * Why a single gate (not per-job feature flags):
 *   - The eligible jobs all share the same risk profile: they touch
 *     production-shaped financial/payment state, and running them
 *     hourly in staging would either (a) burn provider verify quota
 *     against a near-empty database or (b) churn audit logs with
 *     "no entries due" rows that make staging audit grids unreadable.
 *   - A registry-based switch later (e.g. a `staging.disable.jobs[]`
 *     env var) is a trivial extension if the eligible-set grows
 *     beyond what's reasonable to hardcode.
 *
 * Returns true → the cron should skip its work; the caller logs why and
 * returns. Returns false → run normally.
 */
export function shouldSkipScheduledJobInThisEnv(jobKey: string): boolean {
  if (isProduction()) return false;
  return SKIPPED_OUTSIDE_PRODUCTION.has(jobKey);
}

/**
 * Job keys whose scheduled (cron) trigger is suppressed outside
 * production. The ADMIN RUNNER path remains available for all of them
 * — operators can still trigger them manually from /admin/jobs.
 */
const SKIPPED_OUTSIDE_PRODUCTION = new Set<string>([
  "release-available-funds",
  "reconcile-payments",
]);
