import { z } from "zod";
import { type JobHandler } from "../types";

/**
 * `reconcile-payments` — Phase 3 IPN-miss recovery sweep, exposed as an
 * admin-runnable job.
 *
 * Why this lives here:
 *   The hourly Cloud Function `onPaymentReconciliation` already calls the
 *   internal endpoint `POST /v1/internal/payments/reconcile` every 10 min
 *   in production. This handler exposes the SAME service method
 *   (`paymentService.reconcileStuckPayments`) under the admin runner so
 *   that:
 *     1. In staging where the cron is intentionally disabled, operators
 *        can still trigger a sweep manually to test the IPN flow.
 *     2. After a provider outage, an operator can drain a backlog
 *        on-demand without waiting for the next scheduled tick.
 *
 * No duplication: both the cron-fired internal endpoint and this admin
 * handler delegate to the same service method, so the audit + state-flip
 * behaviour is identical regardless of trigger path. The runner-level
 * audit (`admin.job_triggered` / `admin.job_completed`) is layered on top
 * of the canonical `payment.reconciliation_swept` heartbeat the service
 * emits — so a manual run leaves both an admin audit trail AND the same
 * cron heartbeat row that ops dashboards already consume.
 *
 * Defaults are deliberately conservative — same as the internal endpoint:
 *   - windowMinMs: 5 min (give the IPN a chance)
 *   - windowMaxMs: 25 min (let onPaymentTimeout handle older rows)
 *   - batchSize:   50    (≈100s worst-case at 2s/provider RTT)
 */

const inputSchema = z
  .object({
    /** Lower bound — payments newer than this are skipped. Min 1 min so IPN has headroom. */
    windowMinMs: z
      .number()
      .int()
      .min(60 * 1000)
      .max(60 * 60 * 1000)
      .optional(),
    /** Upper bound — payments older than this are left for onPaymentTimeout. */
    windowMaxMs: z
      .number()
      .int()
      .positive()
      .max(60 * 60 * 1000)
      .optional(),
    /** Max payments processed per invocation. Hard ceiling 200. */
    batchSize: z.number().int().positive().max(200).optional(),
  })
  // `.strict()` BEFORE `.refine()` — Zod returns a ZodEffects after a
  // refine and the strict-mode setter is no longer reachable on the
  // wrapper. Flipping the order keeps both unknown-keys rejection AND
  // the cross-field window-min < window-max guard.
  .strict()
  // Same cross-field guard the internal endpoint enforces — operator
  // can't widen the window beyond intent. Keeps ad-hoc admin runs in
  // the same operational box as the cron path.
  .refine(
    (b) =>
      b.windowMinMs === undefined || b.windowMaxMs === undefined || b.windowMinMs < b.windowMaxMs,
    { message: "windowMinMs must be strictly less than windowMaxMs" },
  );

type Input = z.infer<typeof inputSchema>;

export const reconcilePaymentsHandler: JobHandler<Input> = {
  descriptor: {
    jobKey: "reconcile-payments",
    titleFr: "Réconcilier les paiements bloqués",
    titleEn: "Reconcile stuck payments",
    descriptionFr:
      "Interroge le fournisseur de paiement pour les paiements `processing` dans la fenêtre [windowMin, windowMax] et applique le résultat. Idempotent. Fenêtre par défaut : 5–25 min.",
    descriptionEn:
      "Asks the payment provider about `processing` payments within the [windowMin, windowMax] window and applies the verdict. Idempotent. Default window: 5–25 min.",
    hasInput: true,
    exampleInput: { windowMinMs: 5 * 60 * 1000, windowMaxMs: 25 * 60 * 1000, batchSize: 50 },
    dangerNoteFr:
      "Augmenter `batchSize` consomme du quota de vérification fournisseur — à utiliser avec parcimonie.",
    dangerNoteEn: "Bumping `batchSize` burns provider verify quota — use sparingly.",
  },
  inputSchema,
  run: async (input: Input, ctx) => {
    if (ctx.signal.aborted) throw new Error("aborted");

    // Lazy import — paymentService imports event-bus + config + repos,
    // so importing it at module-load time would slow every job-runner
    // boot. Same pattern as the internal route.
    const { paymentService } = await import("@/services/payment.service");

    const stats = await paymentService.reconcileStuckPayments({
      ...(input.windowMinMs !== undefined ? { windowMinMs: input.windowMinMs } : {}),
      ...(input.windowMaxMs !== undefined ? { windowMaxMs: input.windowMaxMs } : {}),
      ...(input.batchSize !== undefined ? { batchSize: input.batchSize } : {}),
    });

    ctx.log("reconcile.swept", stats);

    return (
      `Scanned ${stats.scanned} processing payment(s): ` +
      `${stats.finalizedSucceeded} succeeded, ${stats.finalizedFailed} failed, ` +
      `${stats.stillPending} still pending, ${stats.errored} errored.`
    );
  },
};
