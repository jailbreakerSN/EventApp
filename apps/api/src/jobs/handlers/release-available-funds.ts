import { z } from "zod";
import { type JobHandler } from "../types";

/**
 * `release-available-funds` — admin-runner wrapper around
 * `balanceService.releaseAvailableFunds`.
 *
 * Why this is a thin wrapper:
 *   The actual sweep + audit logic lives on `BalanceService` (single
 *   source of truth for the cron path AND the admin runner). This file
 *   only declares the descriptor (i18n labels, danger note, Zod input
 *   schema) and forwards `ctx` → service args. The pattern matches
 *   `reconcile-payments.ts` → `paymentService.reconcileStuckPayments`.
 *
 * See `apps/api/src/services/balance.service.ts:releaseAvailableFunds`
 * for the contract: input bounds, race semantics, audit-emission
 * shape (`balance_transaction.released` per-org + `balance.release_swept`
 * heartbeat).
 */

/** Hard upper-bound on entries in a single invocation. Schema-enforced. */
const MAX_ENTRIES_PER_RUN = 50_000;

/**
 * Operator-typo grace window on the `asOf` upper bound. The schema
 * rejects an `asOf` more than 5 min in the future to absorb clock skew
 * between the admin's browser, the API server, and Firestore — but
 * never far enough to release scheduled-for-tomorrow entries.
 */
const ASOF_GRACE_MS = 5 * 60_000;

const inputSchema = z
  .object({
    /**
     * Inclusive upper bound on `availableOn`. Defaults to "now" at
     * service-method invocation time. Schema-bounded to {now + 5min}
     * so an operator typo (e.g. "3026-04-26..." → swap-the-decade) can
     * never release every pending entry on the platform — a one-button
     * financial operation needs that guard. The 5-minute headroom
     * handles clock skew between the admin's browser and the API.
     */
    asOf: z
      .string()
      .datetime()
      .refine((v) => new Date(v).getTime() <= Date.now() + ASOF_GRACE_MS, {
        message: "asOf must not be more than 5 minutes in the future",
      })
      .optional(),
    /**
     * Cap on entries flipped per invocation. Defaults to 50_000 inside
     * the service. Lower values are useful for dry-runs / partial
     * sweeps in staging.
     */
    maxEntries: z.coerce.number().int().positive().max(MAX_ENTRIES_PER_RUN).optional(),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

export const releaseAvailableFundsHandler: JobHandler<Input> = {
  descriptor: {
    jobKey: "release-available-funds",
    titleFr: "Libérer les fonds disponibles",
    titleEn: "Release available funds",
    descriptionFr:
      "Passe les entrées `pending` du grand livre dont la fenêtre `availableOn` est écoulée à `status = available`. Une ligne d'audit par organisation. Idempotent.",
    descriptionEn:
      "Graduates `pending` ledger entries whose `availableOn` window has elapsed to `status = available`. One audit row per organization. Idempotent.",
    hasInput: true,
    exampleInput: {},
    dangerNoteFr: null,
    dangerNoteEn: null,
  },
  inputSchema,
  run: async (input: Input, ctx) => {
    if (ctx.signal.aborted) throw new Error("aborted");

    // Lazy import — `balanceService` pulls in the ledger / repos / config
    // graph; loading it at module-init time would slow every job-runner
    // boot. Same pattern as `reconcile-payments.ts`.
    const { balanceService } = await import("@/services/balance.service");

    const result = await balanceService.releaseAvailableFunds({
      ...(input.asOf !== undefined ? { asOf: input.asOf } : {}),
      ...(input.maxEntries !== undefined ? { maxEntries: input.maxEntries } : {}),
      runId: `admin-job:${ctx.runId}`,
      signal: ctx.signal,
      log: ctx.log,
    });

    if (result.released === 0) {
      return `No pending balance entries due as of ${result.asOf}.`;
    }
    return (
      `Released ${result.released} ledger entries across ${result.organizationsAudited} ` +
      `organization(s) (asOf=${result.asOf}).`
    );
  },
};
