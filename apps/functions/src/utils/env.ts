import type { logger as fnLogger } from "firebase-functions/v2";

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
// Tests can override via `process.env.GCLOUD_PROJECT = "..."` in a
// `beforeEach` — see `apps/functions/src/utils/__tests__/env.test.ts`.

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
 * Wrap a scheduled-handler function so it short-circuits with an INFO
 * log in non-production environments. The cron infrastructure stays
 * deployed (so the schedule is visible in Cloud Scheduler / Firebase
 * console), but the handler body is a no-op.
 *
 * Usage colocates the policy with the cron declaration, where future
 * readers will look first:
 *
 *     export const releaseAvailableFunds = onSchedule(
 *       { schedule: "0 * * * *", region: "europe-west1", ... },
 *       productionOnly("balance.release", logger, async () => {
 *         // ...
 *       }),
 *     );
 *
 * The previous shape (a hardcoded `SKIPPED_OUTSIDE_PRODUCTION` set in
 * this file, queried per-trigger via `shouldSkipScheduledJobInThisEnv`)
 * worked but was undiscoverable from the trigger's POV — a future
 * engineer adding a third cron would have to know about the env file
 * to wire the gate. The wrapper makes the intent local and grep-able.
 *
 * `logName` becomes the structured-log `event` field so ops can filter
 * for "scheduled jobs that no-opped today".
 */
export function productionOnly<TArgs extends unknown[]>(
  logName: string,
  logger: typeof fnLogger,
  fn: (...args: TArgs) => Promise<void> | void,
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs): Promise<void> => {
    if (!isProduction()) {
      logger.info(`${logName}: skipped (non-production env)`, {
        event: `${logName}.skipped`,
        env: getTerangaEnv(),
      });
      return;
    }
    await fn(...args);
  };
}
