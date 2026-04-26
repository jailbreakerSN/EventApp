import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { getTerangaEnv, shouldSkipScheduledJobInThisEnv } from "../utils/env";

// ─── Balance release scheduled job (Phase Finance) ───────────────────────────
//
// Hourly cron that graduates `balanceTransactions` entries from
// `status: "pending"` to `status: "available"` once their `availableOn`
// window has elapsed.
//
// Why this exists:
//   The /finance page promises "Libéré 7j après la fin de l'événement"
//   (apps/web-backoffice/src/app/(dashboard)/finance/page.tsx). Without
//   this job, pending entries never graduate — the operator sees their
//   funds locked indefinitely. The release window is computed at
//   payment-succeeded time by `computeAvailableOn()` in
//   apps/api/src/config/finance.ts and stored on each ledger entry.
//
// Architecture:
//   This trigger is a thin scheduler wrapper. The actual sweep + audit
//   logic lives in the API at apps/api/src/jobs/handlers/release-available-funds.ts
//   (function `runReleaseSweep`), called both by:
//     1. The internal endpoint `/v1/internal/balance/release-available`
//        (this trigger's HTTP target).
//     2. The admin runner via /admin/jobs (jobKey:
//        `release-available-funds`) — for staging where this cron is
//        disabled, or post-incident catch-up runs in production.
//   Single source of truth on the API side; this trigger just fires it.
//
// Env policy:
//   In staging + dev the cron short-circuits with an INFO log. The same
//   job logic remains available via /admin/jobs for manual triggering.
//   See apps/functions/src/utils/env.ts.

export const releaseAvailableFunds = onSchedule(
  {
    region: "europe-west1",
    schedule: "0 * * * *", // top of every hour
    timeZone: "Africa/Dakar",
    memory: "256MiB",
    maxInstances: 1, // single-writer; concurrent runs would just contend
    timeoutSeconds: 540,
  },
  async () => {
    // Env guard — staging + dev short-circuit. Operators trigger this
    // manually via /admin/jobs in non-prod environments.
    if (shouldSkipScheduledJobInThisEnv("release-available-funds")) {
      logger.info("balance.release: skipped (non-production env)", {
        env: getTerangaEnv(),
      });
      return;
    }

    const apiBaseUrl = process.env.API_BASE_URL;
    const secret = process.env.INTERNAL_DISPATCH_SECRET;

    if (!apiBaseUrl || !secret) {
      logger.warn("balance.release: missing API_BASE_URL or INTERNAL_DISPATCH_SECRET", {
        hasUrl: Boolean(apiBaseUrl),
        hasSecret: Boolean(secret),
      });
      return;
    }

    const url = `${apiBaseUrl.replace(/\/$/, "")}/v1/internal/balance/release-available`;

    // Client-side timeout bounded BELOW the function's 540s budget so the
    // log emission has headroom even if Cloud Run takes its time. The
    // sweep is a write-bound operation: at BATCH_SIZE 500 and ~50ms per
    // commit, 50_000 entries finish in ~5 minutes — 480s gives that case
    // 30s of headroom while pre-empting pathologically slow Firestore.
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 480_000);

    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Dispatch-Secret": secret,
        },
        // Empty body → endpoint defaults (asOf = now, maxEntries = 50_000).
        body: JSON.stringify({}),
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = JSON.parse(text);
      } catch {
        // non-JSON response (e.g. 502 from upstream) — log raw body bounded.
      }

      if (!response.ok) {
        logger.error("balance.release: API returned non-2xx", {
          status: response.status,
          body: text.slice(0, 1000),
        });
        return;
      }

      const data = (payload as { data?: { released?: number; organizationsAudited?: number } })
        ?.data;
      logger.info("balance.release: sweep complete", {
        released: data?.released ?? 0,
        organizationsAudited: data?.organizationsAudited ?? 0,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        logger.error("balance.release: API call timed out (480s)");
      } else {
        logger.error("balance.release: API call failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  },
);
