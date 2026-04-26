import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { config } from "@/config";
import { validate } from "@/middlewares/validate.middleware";
import { notificationDispatcher } from "@/services/notification-dispatcher.service";
import {
  NotificationLocaleSchema,
  isKnownNotificationKey,
  type NotificationRecipient,
} from "@teranga/shared-types";

// ─── Internal Dispatch Endpoint (Phase 2.3) ────────────────────────────────
//
// Exposes a single HTTPS surface for Cloud Functions (and any other
// trusted server-side caller) to drop notifications into the regular
// dispatcher pipeline. Without this, scheduled jobs in
// `apps/functions/src/triggers/` could only deliver notifications by
// either:
//   (a) duplicating the react-email + Resend adapter stack inside the
//       Functions codebase (massively increases bundle size and splits
//       the template registry into two sources of truth), or
//   (b) writing directly to Firestore notification docs (bypasses admin
//       kill-switches + user opt-out + audit trail — the whole point of
//       the dispatcher).
//
// Instead, every scheduled job POSTs a catalog key + recipients + params
// here, and the API runs the dispatch exactly as if a domain-event
// listener had called `notificationDispatcher.dispatch(...)` directly.
//
// ── Authentication ────────────────────────────────────────────────────
//
// Requests MUST carry `X-Internal-Dispatch-Secret: <env INTERNAL_DISPATCH_SECRET>`.
// The shared secret is compared with `crypto.timingSafeEqual` to prevent
// timing-oracle attacks. On mismatch the route returns a 404 (not 401 or
// 403) so an unauthenticated probe cannot discover whether the endpoint
// exists — matches the posture of the other internal-only routes.
//
// Defense-in-depth: the endpoint is intended to be reachable ONLY from
// GCP egress (Cloud Run's internal networking / IAM-locked invokers). The
// shared secret is a second layer behind that network posture so a
// misconfigured VPC doesn't leak the surface.
//
// ── Rate limiting ─────────────────────────────────────────────────────
//
// Applied via Fastify's plugin-level rate limit config below. Scheduled
// jobs chunk their fanout into batches of <=500 recipients per request,
// so 120 req/minute is plenty for the cron cadence (15-min event
// reminders + daily subscription reminders). The cap prevents a stolen
// secret from being used as a blast amplifier.

const InternalDispatchRecipient = z.object({
  userId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  fcmTokens: z.array(z.string()).optional(),
  preferredLocale: NotificationLocaleSchema.default("fr"),
});

const InternalDispatchBody = z.object({
  key: z.string().min(1).refine(isKnownNotificationKey, {
    message: "Unknown notification catalog key",
  }),
  recipients: z.array(InternalDispatchRecipient).min(1).max(500),
  // Free-form key/value bag — each catalog entry declares its own shape.
  // We don't validate against the template params at the route layer
  // because the dispatcher/adapter is already tolerant of missing keys
  // (renders "undefined" into the template rather than throwing), and
  // mirroring 25+ param shapes at the route boundary would be redundant.
  params: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(1).max(256).optional(),
});

type InternalDispatchBody = z.infer<typeof InternalDispatchBody>;

function timingSafeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // timingSafeEqual requires equal lengths; compare against a
    // same-length dummy so the caller can't distinguish short-token
    // mismatch from wrong-value mismatch via latency.
    crypto.timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Internal-route secret guard — module-scoped so every internal endpoint
 * can apply it as a `preHandler` BEFORE `validate(...)`. An unauthenticated
 * probe with a malformed body MUST see the same 404 as an unauthenticated
 * probe with a syntactically valid body, otherwise the response-code
 * difference (400 vs 404) leaks the existence of the endpoint. Inlining
 * the check after validate (the original `/notifications/dispatch` shape)
 * is the bug pattern; hoisting + sharing this guard prevents drift.
 *
 * Fail-closed (404) when the deployment hasn't provisioned a real secret
 * yet — a Cloud Run service that booted before the ops-prerequisites
 * workflow ran sees the same response shape as an unauthenticated probe,
 * so neither the absence-of-config NOR the wrong-value cases leak the
 * endpoint's existence.
 */
async function internalSecretGuard(request: FastifyRequest, reply: FastifyReply) {
  const providedSecret = request.headers["x-internal-dispatch-secret"];
  const expected = config.INTERNAL_DISPATCH_SECRET;
  if (typeof expected !== "string" || expected.length < 32) {
    return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
  }
  if (
    typeof providedSecret !== "string" ||
    providedSecret.length === 0 ||
    !timingSafeCompare(providedSecret, expected)
  ) {
    return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
  }
}

export const internalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/notifications/dispatch",
    {
      config: {
        // Aggressive cap — intended for scheduled jobs only. Chunked
        // fanout at 500 recipients/request means ~60k notifications
        // per minute is plenty of headroom for every scheduled job
        // combined (participant reminders + subscription reminders +
        // post-event feedback + certificates).
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
        },
      },
      // SECRET CHECK FIRST — before validate, so unauthenticated probes
      // with a malformed body see the same 404 as those with a valid
      // body. Otherwise the response-code difference (400 vs 404) leaks
      // the endpoint's existence. Same posture as the other two
      // internal endpoints below.
      preHandler: [internalSecretGuard, validate({ body: InternalDispatchBody })],
      schema: {
        hide: true, // never exposed in the public Swagger UI
        summary: "Internal dispatcher entry point for Cloud Functions",
        body: {
          type: "object",
          required: ["key", "recipients"],
        },
      },
    },
    async (request, reply) => {
      const body = request.body as InternalDispatchBody;

      const recipients: NotificationRecipient[] = body.recipients.map((r) => ({
        ...(r.userId ? { userId: r.userId } : {}),
        ...(r.email ? { email: r.email } : {}),
        ...(r.phone ? { phone: r.phone } : {}),
        ...(r.fcmTokens ? { fcmTokens: r.fcmTokens } : {}),
        preferredLocale: r.preferredLocale,
      }));

      // Fire-and-forget inside the dispatcher — every failure turns into
      // a suppression audit event. We return 202 (accepted) regardless so
      // the caller's retry budget isn't spent on downstream provider
      // failures; the dispatch log + bounce webhook own the delivery
      // outcome.
      await notificationDispatcher.dispatch({
        key: body.key,
        recipients,
        params: body.params,
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      });

      return reply.status(202).send({ success: true });
    },
  );

  // ─── Phase 3 — Payments Reconciliation Sweep ────────────────────────────
  // Internal endpoint hit by the `paymentReconciliation` Cloud Function
  // every 10 min. Scans Firestore for payments stuck in `processing`
  // past the IPN-window, calls the provider's verify endpoint, and
  // finalises with the same state-machine flip as the IPN webhook.
  //
  // ── Authentication ────────────────────────────────────────────────────
  // Same shared-secret guard as `/notifications/dispatch`. The endpoint
  // is fail-closed (404) when the secret env var is unset or below the
  // minimum length so an un-provisioned environment can't accidentally
  // expose the sweep to the public internet.
  //
  // ── Authorisation ────────────────────────────────────────────────────
  // System-mode — no AuthUser. The service method `reconcileStuckPayments`
  // operates on every Payment in the window without ownership checks
  // (state-machine flips driven by the provider's verify response, not
  // by per-user mutation). The shared-secret + IP-locked Cloud Functions
  // posture is the only line of defence here.
  //
  // ── Rate limiting ────────────────────────────────────────────────────
  // Tighter than the dispatch endpoint (30/min) — the sweep is intended
  // to fire at most once per 10 min, never in parallel. A stolen secret
  // used as a sweep amplifier would burn provider verify quota fast;
  // the cap means even a flooded attacker can trigger at most 30 sweeps
  // per minute, each bounded by `batchSize` (default 50) → at most
  // 1500 verify calls/min/instance.
  const ReconcileBody = z
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
    // `.strict()` BEFORE `.refine()` — Zod returns a ZodEffects after
    // a refine and the strict-mode setter is no longer reachable on
    // the wrapper. Order matters; matches the equivalent guard in
    // `apps/api/src/jobs/handlers/reconcile-payments.ts:inputSchema`.
    .strict()
    // FAIL-3 fix — cross-field validation. Without this a stolen secret
    // could submit `{ windowMinMs: 60000, windowMaxMs: 3600000 }` to
    // sweep every processing payment up to 1 h old in one call,
    // bypassing the operational "give the IPN a chance" intent.
    .refine(
      (b) =>
        b.windowMinMs === undefined || b.windowMaxMs === undefined || b.windowMinMs < b.windowMaxMs,
      { message: "windowMinMs must be strictly less than windowMaxMs" },
    );

  fastify.post(
    "/payments/reconcile",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      // SECRET CHECK FIRST — before validate, so unauth probes see the
      // same 404 regardless of body shape (closes the auth-bypass oracle
      // surfaced by the security review).
      preHandler: [internalSecretGuard, validate({ body: ReconcileBody })],
      schema: {
        hide: true,
        summary: "Internal — Phase 3 payments reconciliation sweep",
      },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof ReconcileBody>;

      // Lazy import to avoid the circular require risk in the route
      // module (paymentService imports event-bus + config + …).
      const { paymentService } = await import("@/services/payment.service");
      const stats = await paymentService.reconcileStuckPayments({
        ...(body.windowMinMs !== undefined ? { windowMinMs: body.windowMinMs } : {}),
        ...(body.windowMaxMs !== undefined ? { windowMaxMs: body.windowMaxMs } : {}),
        ...(body.batchSize !== undefined ? { batchSize: body.batchSize } : {}),
      });

      return reply.status(200).send({ success: true, data: stats });
    },
  );

  // ── Balance release sweep (Phase Finance) ──────────────────────────────
  // Cron-fired endpoint that the hourly `releaseAvailableFunds` Cloud
  // Function calls (with the X-Internal-Dispatch-Secret). Delegates to
  // `balanceService.releaseAvailableFunds` — the SAME service method the
  // admin /admin/jobs runner calls via `release-available-funds.ts` —
  // so the two trigger paths can never drift.
  //
  // Authorisation, rate-limiting, fail-closed-404 semantics: identical
  // to /payments/reconcile above. The secret guard runs FIRST so
  // unauthenticated probes can't oracle the endpoint via response codes.
  //
  // Body is intentionally narrow: cron always runs with default args,
  // but supports `asOf` / `maxEntries` for emergency catch-up runs.
  // The default cron `maxEntries` is enforced server-side at 5_000
  // (one cron-tick = one page of work; backlog drains over multiple
  // ticks) — operators triggering from /admin/jobs may raise it via
  // the runner's input.
  const CRON_DEFAULT_MAX_ENTRIES = 5_000;
  const ReleaseAvailableBody = z
    .object({
      // Same upper-bound rule as the admin handler (5-min grace) so the
      // cron path can't accidentally widen the sweep window via a
      // misconfigured body.
      asOf: z
        .string()
        .datetime()
        .refine((v) => new Date(v).getTime() <= Date.now() + 5 * 60_000, {
          message: "asOf must not be more than 5 minutes in the future",
        })
        .optional(),
      maxEntries: z.coerce.number().int().positive().max(50_000).optional(),
    })
    .strict();

  fastify.post(
    "/balance/release-available",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      preHandler: [internalSecretGuard, validate({ body: ReleaseAvailableBody })],
      schema: {
        hide: true,
        summary: "Internal — release pending balance entries past their availableOn window",
      },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof ReleaseAvailableBody>;

      // Lazy import to mirror the /payments/reconcile pattern and dodge
      // the same circular-require risk (the service module imports
      // event-bus + repos + config at module-init).
      const { balanceService } = await import("@/services/balance.service");
      const result = await balanceService.releaseAvailableFunds({
        ...(body.asOf !== undefined ? { asOf: body.asOf } : {}),
        // Cron default cap (5_000) is below the service's hard ceiling
        // (50_000). Operators on /admin/jobs can raise it explicitly.
        maxEntries: body.maxEntries ?? CRON_DEFAULT_MAX_ENTRIES,
        runId: `system:cron-${crypto.randomUUID()}`,
      });

      return reply.status(200).send({ success: true, data: result });
    },
  );
};
