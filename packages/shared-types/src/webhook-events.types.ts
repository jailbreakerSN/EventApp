import { z } from "zod";

/**
 * T2.1 — Payment webhook events log + replay.
 *
 * Architecture mirrors Stripe's Events dashboard: every received
 * provider webhook is persisted with its raw body + processing
 * outcome. Operators can re-invoke the handler from the admin UI to
 * recover from transient failures (Firestore hiccup, deploy-time
 * crash, backfill after a bug fix).
 *
 * Design decisions:
 *   - **Doc id = `${provider}__${providerTransactionId}__${status}`.**
 *     Makes the writer idempotent — a retry from Wave with the same
 *     (transaction, status) triple converges on the same row. Status
 *     transitions (pending → succeeded, pending → failed) produce
 *     distinct rows so audit + replay have full visibility.
 *   - **Store raw body + parsed shape.** Raw for signature re-verify
 *     in future debugging; parsed for replay (we already verified the
 *     signature at receipt time, replay doesn't re-verify).
 *   - **Replay is idempotent.** `paymentService.handleWebhook` already
 *     guards against double-processing via the payment status check,
 *     so replaying a "processed" event is safe — the handler fast-
 *     returns and the attempt counter still ticks.
 *   - **Industry precedent:** Stripe, Svix, Hookdeck — all use the
 *     same log-first / replay pattern.
 */

// ─── Processing status ───────────────────────────────────────────────────────

export const WebhookProcessingStatusSchema = z.enum([
  "received", // row created; handler hasn't run yet
  "processed", // handler returned without throwing
  "failed", // handler threw (last attempt)
]);
export type WebhookProcessingStatus = z.infer<typeof WebhookProcessingStatusSchema>;

// ─── Providers ───────────────────────────────────────────────────────────────
// Narrow list of the provider names we actually handle today. Keeping
// this separate from `PaymentMethodSchema` (which includes wallets not
// used via webhook) so Trivy doesn't chase false paths and the type
// system catches a new-provider addition at the call site.
//
// Phase 2 — `paydunya` is the aggregator provider that fronts Wave /
// OM / Free Money / card via a single IPN endpoint. It's a webhook
// SOURCE (we accept POSTs from PayDunya) but NOT a `PaymentMethod`
// (users don't pick "paydunya" — they pick Wave / OM / etc., and
// the registry routes through PayDunya based on env config). Keeping
// the two schemas separate lets each evolve independently.
export const WebhookProviderSchema = z.enum([
  "wave",
  "orange_money",
  "free_money",
  "card",
  "mock",
  "paydunya",
]);
export type WebhookProvider = z.infer<typeof WebhookProviderSchema>;

// ─── Stored event ────────────────────────────────────────────────────────────

export const WebhookEventLogSchema = z.object({
  /**
   * Composite doc id: `${provider}__${providerTransactionId}__${status}`.
   * Idempotent — a retry from the provider re-writes the same row.
   */
  id: z.string(),
  provider: WebhookProviderSchema,
  providerTransactionId: z.string(),
  /**
   * The `status` field from the webhook body — NOT to be confused
   * with `processingStatus` (the outcome of OUR handler). Both enums
   * are intentionally narrow so audit queries can filter on either.
   */
  providerStatus: z.enum(["succeeded", "failed"]),
  /** Best-effort event-type label surfaced in UI lists. */
  eventType: z.string().nullable(),
  /**
   * Verbatim HTTPS body we received. Up to ~16 KB in practice; hard
   * cap at 64 KB for Firestore doc-size hygiene.
   */
  rawBody: z.string().max(64 * 1024),
  /**
   * Headers at receipt time, lowercased keys. Filtered to the subset
   * providers actually sign over — no auth tokens, no cookies. Used
   * for future signature re-verification or transport debugging.
   */
  rawHeaders: z.record(z.string(), z.string()),
  /**
   * Parsed + validated metadata we pass to the handler on both
   * receipt and replay. Kept separate from rawBody so replay
   * doesn't have to re-parse.
   */
  metadata: z.record(z.string(), z.unknown()).nullable(),

  processingStatus: WebhookProcessingStatusSchema,
  /** Incremented on each processing attempt (receipt + every replay). */
  attempts: z.number().int().nonnegative(),
  /**
   * Optional paymentId + organizationId — stamped best-effort once
   * `paymentService.handleWebhook` has located the payment. `null`
   * when the webhook arrives BEFORE the payment row exists (race
   * between checkout init and provider callback), which is a
   * legitimate transient state.
   */
  paymentId: z.string().nullable(),
  organizationId: z.string().nullable(),

  firstReceivedAt: z.string().datetime(),
  lastAttemptedAt: z.string().datetime().nullable(),
  /**
   * Firestore TTL field — the sweep deletes the row once `expiresAt`
   * is in the past. Computed at receipt time as `firstReceivedAt +
   * 90 days` (stored as a Firestore Timestamp, serialised to ISO
   * across the API boundary). See
   * `infrastructure/firebase/firestore.ttl.md` for the provisioning
   * runbook + retention rationale.
   */
  expiresAt: z.string().datetime(),
  /** Last error that aborted a processing attempt; null on success. */
  lastError: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
  /** Propagated request id of the latest attempt — joins with audit. */
  requestId: z.string().nullable(),
});
export type WebhookEventLog = z.infer<typeof WebhookEventLogSchema>;

// ─── Query DTOs ──────────────────────────────────────────────────────────────

export const AdminWebhookEventsQuerySchema = z.object({
  provider: WebhookProviderSchema.optional(),
  processingStatus: WebhookProcessingStatusSchema.optional(),
  providerStatus: z.enum(["succeeded", "failed"]).optional(),
  /** ISO date — only events with firstReceivedAt >= this. */
  since: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type AdminWebhookEventsQuery = z.infer<typeof AdminWebhookEventsQuerySchema>;
