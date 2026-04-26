import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { webhookIpAllowlist } from "@/middlewares/webhook-ip-allowlist.middleware";
import {
  paymentService,
  signWebhookPayload,
  getProviderForWebhook,
} from "@/services/payment.service";
import { webhookEventsService } from "@/services/webhook-events.service";
import { MockPaymentProvider } from "@/providers/mock-payment.provider";
import { config } from "@/config";
import {
  InitiatePaymentSchema,
  PaymentWebhookSchema,
  RefundPaymentSchema,
  PaymentQuerySchema,
  WebhookProviderSchema,
  type WebhookProvider,
} from "@teranga/shared-types";

const ParamsWithPaymentId = z.object({ paymentId: z.string() });
const ParamsWithEventId = z.object({ eventId: z.string() });
type ParamsWithTxId = { txId: string };

// ─── HTML Escaping ──────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJs(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/<\//g, "<\\/");
}

// ─── Mock Branding (dev only) ────────────────────────────────────────────────
//
// Visual-only theming for the mock checkout page. Lets devs click through a
// Wave-looking / OM-looking / Free-looking screen to spot-check the flow their
// users will eventually see once the real provider is wired in. The mock
// backend flow (HMAC-signed webhook → paymentService.handleWebhook) is
// identical regardless of which method the user picked.

interface MockBranding {
  title: string;
  name: string;
  logo: string;
  subtitle: string;
  heading: string;
  color: string;
  payLabel: string;
  showPhoneField: boolean;
  phoneLabel: string;
  processingMsg: string;
}

function getMockBranding(method: string): MockBranding {
  switch (method) {
    case "wave":
      return {
        title: "Wave",
        name: "Wave",
        logo: "Wave",
        subtitle: "Mobile Money — Sénégal",
        heading: "Confirmer votre paiement Wave",
        color: "#1DC8F1",
        payLabel: "Payer avec Wave",
        showPhoneField: true,
        phoneLabel: "Numéro Wave",
        processingMsg: "Envoi de la demande Wave…",
      };
    case "orange_money":
      return {
        title: "Orange Money",
        name: "Orange Money",
        logo: "Orange Money",
        subtitle: "Paiement sécurisé",
        heading: "Confirmer votre paiement Orange Money",
        color: "#FF7900",
        payLabel: "Payer avec Orange Money",
        showPhoneField: true,
        phoneLabel: "Numéro Orange Money",
        processingMsg: "Envoi du code USSD #144#…",
      };
    case "free_money":
      return {
        title: "Free Money",
        name: "Free Money",
        logo: "Free Money",
        subtitle: "Paiement mobile",
        heading: "Confirmer votre paiement Free Money",
        color: "#CD0067",
        payLabel: "Payer avec Free Money",
        showPhoneField: true,
        phoneLabel: "Numéro Free Money",
        processingMsg: "Envoi de la demande Free Money…",
      };
    case "card":
      return {
        title: "Carte bancaire",
        name: "Carte bancaire",
        logo: "VISA / MasterCard",
        subtitle: "Paiement sécurisé par carte",
        heading: "Confirmer votre paiement par carte",
        color: "#1F2937",
        payLabel: "Payer par carte",
        showPhoneField: false,
        phoneLabel: "",
        processingMsg: "Contact de la banque émettrice…",
      };
    default:
      return {
        title: "Paiement",
        name: "Mode test",
        logo: "Teranga",
        subtitle: "Simulation de paiement",
        heading: "Paiement (mode test)",
        color: "#16A34A",
        payLabel: "Payer",
        showPhoneField: false,
        phoneLabel: "",
        processingMsg: "Traitement en cours…",
      };
  }
}

export const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Initiate Payment ─────────────────────────────────────────────────────
  fastify.post(
    "/initiate",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("payment:initiate"),
        validate({ body: InitiatePaymentSchema }),
      ],
      schema: {
        tags: ["Payments"],
        summary: "Initiate a payment for a paid ticket",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId, ticketTypeId, method, returnUrl } = request.body as z.infer<
        typeof InitiatePaymentSchema
      >;
      // P1-06 (audit C1) — Idempotency-Key header. Industry-standard
      // shape (Stripe / Adyen): a UUID per intent, replayed verbatim
      // on automatic retry. The service falls back to a server-
      // synthesised key if the header is absent (60 s bucket; see
      // payment.service.ts).
      const rawIk = request.headers["idempotency-key"];
      const idempotencyKey =
        typeof rawIk === "string" && rawIk.trim().length > 0 && rawIk.trim().length <= 255
          ? rawIk.trim()
          : undefined;
      const result = await paymentService.initiatePayment(
        eventId,
        ticketTypeId,
        method,
        returnUrl,
        request.user!,
        { idempotencyKey },
      );
      return reply.status(201).send({ success: true, data: result });
    },
  );

  // ─── Provider-specific raw-body parsers ───────────────────────────────────
  // Webhook signature verification MUST run over the exact bytes the
  // provider signed. The default Fastify JSON parser reorders keys on
  // re-serialise, breaking HMAC comparisons with Wave/OM. Register a
  // content-type parser scoped to the webhook paths that attaches the
  // raw string to `request.rawBody` AND still parses JSON into
  // `request.body` so the route handlers keep working unchanged.
  // Path-anchored predicate that classifies the request as a webhook
  // route. We strip the query string first so an attacker can't
  // smuggle `/webhook/` via `?ref=/webhook/x`, and we anchor on a
  // slash boundary so `mock-checkout-webhook` (hypothetical sibling
  // path) wouldn't match. Used by both the JSON parser AND the
  // form-encoded parser to keep their scopes consistent.
  const isWebhookRequest = (req: FastifyRequest): boolean => {
    const path = (req.url ?? "").split("?")[0];
    return /\/webhook(?:\/|$)/.test(path);
  };

  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body: string, done) => {
      try {
        // Only attach rawBody on webhook paths — elsewhere the usual
        // parsed-body flow is what downstream handlers expect. The
        // path check is anchored on a slash boundary (NOT a substring)
        // so a request whose query-string contains `/webhook/` can't
        // smuggle the rawBody attachment onto a non-webhook route.
        if (isWebhookRequest(req)) {
          (req as FastifyRequest & { rawBody?: string }).rawBody = body;
        }
        const parsed = body ? JSON.parse(body) : {};
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Phase 2 — PayDunya IPN parser. PayDunya posts the IPN as
  // `application/x-www-form-urlencoded` with a SINGLE field `data`
  // whose value is a JSON-stringified payload. The signature
  // (SHA-512 of the merchant MasterKey) is INSIDE that JSON, so we:
  //   1. capture the raw body for `verifyWebhook` (which extracts
  //      `data=` via URLSearchParams, not via a re-serialised object)
  //   2. parse `data` into `request.body` so the downstream handler
  //      can read `body.providerTransactionId` / `body.status` /
  //      `body.metadata` exactly like the JSON-shaped Wave/OM webhooks
  //
  // Why scope this to webhook paths only: the rest of the API
  // (e.g. /admin form submissions if any) never receives PayDunya
  // shape, so leaking this parser globally would mask bugs.
  fastify.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (req, body: string, done) => {
      try {
        // Path-anchored scope check (see `isWebhookRequest` above).
        // Substring-match would let an attacker smuggle `/webhook/`
        // via a query-string and trigger the form-encoded code path
        // on a non-webhook route — surfaced by Phase-2 security audit.
        if (!isWebhookRequest(req)) {
          // Outside webhook paths: surface a clean 415. Without an
          // explicit statusCode the error handler defaults to 500,
          // which the global onRequest hook in app.ts ALREADY
          // prevents in production (it returns 415 itself before
          // we ever reach this parser). In tests the parser is
          // exercised directly, so we set the statusCode here for
          // a consistent contract.
          const err: Error & { statusCode?: number } = new Error(
            "Content-Type application/x-www-form-urlencoded is only accepted on webhook routes",
          );
          err.statusCode = 415;
          done(err, undefined);
          return;
        }
        (req as FastifyRequest & { rawBody?: string }).rawBody = body;
        // Extract the `data` field; convert its JSON contents into
        // the canonical PaymentWebhookSchema shape (providerTxId +
        // status + metadata) so the existing webhook handler works
        // unchanged for both JSON and form-encoded providers.
        const params = new URLSearchParams(body);
        const dataStr = params.get("data");
        if (!dataStr) {
          done(null, {});
          return;
        }
        // Phase-2 security review B-1 — `dataStr` is attacker-
        // controlled. A SyntaxError from `JSON.parse` here used to
        // propagate to the outer catch which called
        // `done(err as Error, undefined)`. Fastify serialised that
        // raw error message into the 500 response body, leaking the
        // parser internals. Catch the parse separately and respond
        // with a clean 400 — the verifyWebhook step would have
        // rejected the payload anyway, but failing fast here keeps
        // the error contract predictable for monitoring dashboards.
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(dataStr) as Record<string, unknown>;
        } catch {
          const err: Error & { statusCode?: number } = new Error(
            "Webhook payload is not valid JSON",
          );
          err.statusCode = 400;
          done(err, undefined);
          return;
        }
        // Project PayDunya's payload shape onto our canonical webhook
        // schema. PayDunya invoice `token` → `providerTransactionId`;
        // PayDunya `status` ("completed" / "cancelled" / …) → our
        // narrow ("succeeded" / "failed") via mapping. Anything else
        // (`pending`, unknown) drops to `failed` defensively — the
        // handler treats it as a no-op via the inner-tx idempotency
        // guard.
        const invoice =
          payload && typeof payload === "object" && payload.invoice && typeof payload.invoice === "object"
            ? (payload.invoice as Record<string, unknown>)
            : {};
        const customData =
          payload && typeof payload === "object" && payload.custom_data && typeof payload.custom_data === "object"
            ? (payload.custom_data as Record<string, unknown>)
            : {};
        // Anti-tampering invariants (T-PD-03 / T-PD-04). PayDunya
        // signs the IPN with SHA-512(MasterKey) — a valid signature
        // proves the request came from PayDunya but does NOT bind
        // the payload to any specific Payment. A malicious actor who
        // briefly intercepted any valid PayDunya webhook could
        // re-emit it with a tampered amount or substituted token.
        // The handler defends with three cross-checks (executed in
        // `handleWebhook`):
        //   1. Payment.providerTransactionId === invoice.token
        //   2. Payment.amount             === invoice.total_amount
        //   3. Payment.id                 === custom_data.payment_id
        // Surface the expected values explicitly on metadata so the
        // handler doesn't re-parse the raw payload.
        //
        // Phase-2 security review P-2 — we deliberately do NOT carry
        // the full PayDunya payload on `metadata` because:
        //   1. The full body is already persisted on
        //      `webhookEvents/<id>.rawBody` for forensic replay.
        //   2. `metadata` is written to `Payment.providerMetadata`,
        //      which inflates the Firestore doc and duplicates the
        //      `hash` field (SHA-512 of MasterKey).
        // Surface only the projection fields the handler needs.
        const mapped = {
          providerTransactionId: typeof invoice.token === "string" ? invoice.token : "",
          status:
            payload.status === "completed" ? "succeeded" : "failed",
          metadata: {
            providerName: "paydunya",
            // Cross-check fields surfaced for the handler to verify
            // BEFORE entering the tx. Non-null when PayDunya sent
            // them; null tells the handler to skip the check (other
            // providers don't carry these).
            expectedAmount:
              typeof invoice.total_amount === "number" ? invoice.total_amount : null,
            expectedPaymentId:
              typeof customData.payment_id === "string" ? customData.payment_id : null,
            // Surface the PayDunya-side `response_code` for operator
            // forensics; cheap to keep + part of every PayDunya IPN.
            providerCode:
              typeof payload.response_code === "string" ? payload.response_code : null,
            // Raw status from the provider, useful when the canonical
            // mapping (completed → succeeded, …) hides the original
            // value (e.g. `expired` becomes `failed`).
            providerStatus: typeof payload.status === "string" ? payload.status : null,
          },
        };
        done(null, mapped);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ─── Webhook (no auth — called by payment provider) ───────────────────────
  // Per-provider signature verification via `provider.verifyWebhook(...)`.
  // Each provider knows its own scheme (Wave: HMAC; OM: pre-shared
  // token; Mock: shared dev secret). Historically this route ran a
  // single HMAC over a JSON.stringify of the already-parsed body — it
  // would have rejected every real Wave/OM webhook in production
  // because neither provider signs Teranga's arbitrary re-serialisation
  // of their payload.
  //
  // Layered rate-limit: the global limiter still applies, but we also
  // bound this endpoint tightly (600 req/min) to keep a single
  // misbehaving provider gateway from exhausting the global bucket
  // for regular API traffic.
  // Phase 2 — accept the broader `WebhookProviderSchema` here so
  // PayDunya IPNs (POSTs to `/v1/payments/webhook/paydunya`) resolve.
  // `WebhookProvider` is the SOURCE list (who can send us webhooks);
  // `PaymentMethod` is the DESTINATION list (what users can pick at
  // checkout). They overlap on `wave` / `orange_money` / `free_money`
  // / `card` / `mock` and diverge on `paydunya` (webhook-only).
  const ParamsWithProvider = z.object({
    provider: WebhookProviderSchema,
  });

  fastify.post(
    "/webhook/:provider",
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: "1 minute",
        },
      },
      // P1-15 (audit H6) — IP allowlist runs BEFORE the validate
      // preHandler so a request from outside the provider's documented
      // webhook CIDRs gets rejected with a 403 before its body is
      // parsed, the HMAC is computed, or any Firestore read fires.
      // Defence-in-depth: a leaked HMAC secret stays useless without
      // network-layer access. Fail-open if the env var for this
      // provider is unset (dev / staging posture); fail-closed when
      // operators have pinned the allowlist.
      preHandler: [
        webhookIpAllowlist,
        validate({ params: ParamsWithProvider, body: PaymentWebhookSchema }),
      ],
      schema: {
        tags: ["Payments"],
        summary: "Payment provider webhook callback (per-provider signature verification)",
      },
    },
    async (request, reply) => {
      const { provider: providerName } = request.params as z.infer<typeof ParamsWithProvider>;
      const provider = getProviderForWebhook(providerName);
      if (!provider) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: `Fournisseur « ${providerName} » inconnu` },
        });
      }

      // Phase-2 audit follow-up — explicit fail-CLOSED instead of
      // silently re-serialising. If `rawBody` is missing the parser
      // didn't run (or ran wrong), and `JSON.stringify(request.body)`
      // would be a re-ordered serialisation that breaks every
      // signed-body provider (Wave HMAC, PayDunya SHA-512). Better
      // to refuse loudly than to silently 403 every webhook.
      const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
      if (typeof rawBody !== "string") {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Webhook raw body unavailable — content-type-parser misconfigured for this route.",
          },
        });
      }

      if (!provider.verifyWebhook({ rawBody, headers: request.headers })) {
        return reply.status(403).send({
          success: false,
          error: { code: "FORBIDDEN", message: "Signature de webhook invalide" },
        });
      }

      const { providerTransactionId, status, metadata } = request.body as z.infer<
        typeof PaymentWebhookSchema
      >;

      // T2.1 — persist the receipt BEFORE invoking the handler so a
      // crash mid-processing still leaves a replayable row. Idempotent
      // on (provider, tx, status): a retry from the provider bumps
      // `attempts` without duplicating the row.
      const logId = await webhookEventsService.record({
        provider: providerName as WebhookProvider,
        providerTransactionId,
        providerStatus: status,
        eventType: `payment.${status}`,
        rawBody,
        rawHeaders: request.headers as Record<string, string | string[] | undefined>,
        metadata: metadata ?? null,
      });

      try {
        await paymentService.handleWebhook(providerTransactionId, status, metadata);
        // Mark processed AFTER the handler returns so a failure lands
        // as `failed` even if markOutcome itself throws — the handler
        // wrote no partial state, so an un-marked row at worst looks
        // "stuck in received" which is investigable.
        await webhookEventsService.markOutcome({ id: logId, processingStatus: "processed" });
        return reply.send({ success: true });
      } catch (err: unknown) {
        const isNotFound =
          err && typeof err === "object" && "name" in err && err.name === "NotFoundError";
        await webhookEventsService.markOutcome({
          id: logId,
          processingStatus: "failed",
          lastError: {
            code: isNotFound ? "NOT_FOUND" : "HANDLER_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
        });
        if (isNotFound) {
          return reply.status(404).send({
            success: false,
            error: { code: "NOT_FOUND", message: "Transaction inconnue" },
          });
        }
        throw err;
      }
    },
  );

  // ─── Webhook (legacy path — no provider specified) ───────────────────────
  // Kept alive for the dev/staging mock-checkout page that still POSTs
  // to `/v1/payments/webhook`. Hard-coded to the mock provider so no
  // unsigned path exists for real providers. Returns 404 in production
  // — real providers MUST post to `/webhook/:provider` going forward.
  fastify.post(
    "/webhook",
    {
      config: {
        rateLimit: { max: 600, timeWindow: "1 minute" },
      },
      preHandler: [validate({ body: PaymentWebhookSchema })],
      schema: {
        tags: ["Payments"],
        summary: "Legacy webhook (mock provider only — real providers must use /webhook/:provider)",
      },
    },
    async (request, reply) => {
      if (config.NODE_ENV === "production") {
        return reply.status(404).send({
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Utilisez /v1/payments/webhook/:provider avec l'identifiant du fournisseur",
          },
        });
      }
      const provider = getProviderForWebhook("mock");
      if (!provider) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Mock provider indisponible" },
        });
      }
      // Same fail-CLOSED contract as the per-provider webhook above.
      // The legacy /webhook endpoint is mock-only in dev/staging,
      // but the explicit guard prevents a future provider that POSTs
      // here with form-encoded (without the parser registering
      // rawBody) from silently failing signature verification.
      const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
      if (typeof rawBody !== "string") {
        return reply.status(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Webhook raw body unavailable — content-type-parser misconfigured for this route.",
          },
        });
      }
      if (!provider.verifyWebhook({ rawBody, headers: request.headers })) {
        return reply.status(403).send({
          success: false,
          error: { code: "FORBIDDEN", message: "Signature de webhook invalide" },
        });
      }
      const { providerTransactionId, status, metadata } = request.body as z.infer<
        typeof PaymentWebhookSchema
      >;
      // T2.1 — same log-first pattern as /webhook/:provider. The
      // legacy /webhook endpoint is mock-only in dev/staging, but
      // it's the path the mock-checkout page exercises so its
      // receipts need to show up in /admin/webhooks too.
      const logId = await webhookEventsService.record({
        provider: "mock",
        providerTransactionId,
        providerStatus: status,
        eventType: `payment.${status}`,
        rawBody,
        rawHeaders: request.headers as Record<string, string | string[] | undefined>,
        metadata: metadata ?? null,
      });
      try {
        await paymentService.handleWebhook(providerTransactionId, status, metadata);
        await webhookEventsService.markOutcome({ id: logId, processingStatus: "processed" });
        return reply.send({ success: true });
      } catch (err: unknown) {
        const isNotFound =
          err && typeof err === "object" && "name" in err && err.name === "NotFoundError";
        await webhookEventsService.markOutcome({
          id: logId,
          processingStatus: "failed",
          lastError: {
            code: isNotFound ? "NOT_FOUND" : "HANDLER_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
        });
        if (isNotFound) {
          return reply.status(404).send({
            success: false,
            error: { code: "NOT_FOUND", message: "Transaction inconnue" },
          });
        }
        throw err;
      }
    },
  );

  // ─── Get Payment Status ───────────────────────────────────────────────────
  fastify.get(
    "/:paymentId/status",
    {
      preHandler: [
        authenticate,
        requirePermission("payment:read_own"),
        validate({ params: ParamsWithPaymentId }),
      ],
      schema: {
        tags: ["Payments"],
        summary: "Get payment status (polling)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { paymentId } = request.params as z.infer<typeof ParamsWithPaymentId>;
      const payment = await paymentService.getPaymentStatus(paymentId, request.user!);
      return reply.send({ success: true, data: payment });
    },
  );

  // ─── Phase B-2 — Resume an in-flight payment ─────────────────────────────
  // User came back from the PayDunya hosted page without completing
  // (closed the tab, network blip, distracted). The payment is in
  // status=processing with the original redirectUrl still valid.
  // This endpoint returns that redirectUrl so the participant web
  // app can re-launch the same checkout session — no double-charge,
  // no orphan Payment, no new PayDunya invoice.
  //
  // The service-layer guards reject the resume on any non-resumable
  // status (succeeded, failed, refunded, expired, pending), each
  // with a typed `details.reason` so the UI can render targeted
  // copy. Cf. `PaymentService.resumePayment` for the full matrix.
  //
  // Permission: `payment:initiate` (same as the original initiate).
  // Owner-only — see the service-layer check.
  fastify.post(
    "/:paymentId/resume",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("payment:initiate"),
        validate({ params: ParamsWithPaymentId }),
      ],
      schema: {
        tags: ["Payments"],
        summary: "Resume an in-flight payment (return existing redirectUrl)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { paymentId } = request.params as z.infer<typeof ParamsWithPaymentId>;
      const result = await paymentService.resumePayment(paymentId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Verify-on-return — ADR-0018 ──────────────────────────────────────────
  // Robust fallback when the provider's IPN webhook doesn't deliver
  // (PayDunya sandbox is the canonical case). The participant is
  // redirected back from the hosted checkout to /payment-status; the
  // page calls this endpoint once on mount, which proactively reads
  // the official payment state via `provider.verify()` and finalises
  // the Payment with the SAME state-machine flip the IPN webhook would
  // have done — atomic Payment + Registration + counter + ledger
  // entries, plus the canonical `payment.succeeded` / `payment.failed`
  // emit. Idempotent: a no-op if the IPN has already finalised the
  // Payment, AND the verify call itself is skipped on terminal status
  // so a chatty front-end can't flood the provider.
  //
  // Permission: `payment:read_own` — verify is a read of the
  // provider's official state (no NEW state requested), so the read-
  // own permission is sufficient. The service-layer ownership check
  // narrows it further to "this user's own payment".
  //
  // Rate-limit: tighter than the global bucket (20/min/user) because
  // a misbehaving front-end on retry-loop must not cascade into the
  // provider's API quota. /payment-status normally calls this exactly
  // once per flow; legitimate retry from a user clicking "Vérifier
  // maintenant" is bounded.
  fastify.post(
    "/:paymentId/verify",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      preHandler: [
        authenticate,
        requirePermission("payment:read_own"),
        validate({ params: ParamsWithPaymentId }),
      ],
      schema: {
        tags: ["Payments"],
        summary: "Verify a payment with the provider (verify-on-return fallback for IPN)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { paymentId } = request.params as z.infer<typeof ParamsWithPaymentId>;
      const result = await paymentService.verifyAndFinalize(paymentId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── List Event Payments (organizer) ──────────────────────────────────────
  fastify.get(
    "/event/:eventId",
    {
      preHandler: [
        authenticate,
        requirePermission("payment:read_all"),
        validate({ params: ParamsWithEventId, query: PaymentQuerySchema }),
      ],
      schema: {
        tags: ["Payments"],
        summary: "List payments for an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { status, method, page, limit } = request.query as z.infer<typeof PaymentQuerySchema>;
      const result = await paymentService.listEventPayments(
        eventId,
        { status, method },
        { page: page ?? 1, limit: limit ?? 20 },
        request.user!,
      );
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Event Payment Summary (revenue dashboard) ────────────────────────────
  fastify.get(
    "/event/:eventId/summary",
    {
      preHandler: [
        authenticate,
        requirePermission("payment:view_reports"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Payments"],
        summary: "Get payment summary for an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const summary = await paymentService.getEventPaymentSummary(eventId, request.user!);
      return reply.send({ success: true, data: summary });
    },
  );

  // ─── Refund Payment ───────────────────────────────────────────────────────
  fastify.post(
    "/:paymentId/refund",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("payment:refund"),
        validate({ params: ParamsWithPaymentId, body: RefundPaymentSchema }),
      ],
      schema: {
        tags: ["Payments"],
        summary: "Refund a payment (full or partial)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { paymentId } = request.params as z.infer<typeof ParamsWithPaymentId>;
      const { amount, reason } = request.body as z.infer<typeof RefundPaymentSchema>;
      const payment = await paymentService.refundPayment(paymentId, amount, reason, request.user!);
      return reply.send({ success: true, data: payment });
    },
  );

  // ─── Mock Checkout Routes (non-production) ────────────────────────────────
  // Mounted in dev AND staging, since the provider registry in
  // `payment.service.ts` falls back to `mockPaymentProvider` whenever
  // the real provider API keys (WAVE_API_KEY, ORANGE_MONEY_CLIENT_ID)
  // aren't set — which is the normal staging posture. Without these
  // routes mounted in staging, the `redirectUrl` returned by the mock
  // provider would 404 at `/v1/payments/mock-checkout/:txId` and the
  // paid-ticket flow would be untestable end-to-end.
  //
  // Production stays safe via two independent guards in payment.service:
  // `getProvider()` and `getProviderForWebhook()` both refuse the mock
  // method when NODE_ENV === "production", so no pending transaction can
  // exist for MockPaymentProvider.getState() to return even if this
  // route were somehow reached. `returnUrl` is also pre-validated by
  // `assertAllowedReturnUrl()` against the owned-hosts allowlist before
  // being stored, so the HTML/JS embedding below cannot be coerced into
  // an open redirect off an attacker-supplied host.
  if (config.NODE_ENV !== "production") {
    // ─── Mock Checkout Page (dev/test only) ───────────────────────────────────
    fastify.get(
      "/mock-checkout/:txId",
      {
        schema: {
          tags: ["Payments"],
          summary: "Mock checkout page (dev only)",
        },
      },
      async (request, reply) => {
        const { txId } = request.params as ParamsWithTxId;
        const state = MockPaymentProvider.getState(txId);

        if (!state) {
          return reply.status(404).send({
            success: false,
            error: { code: "NOT_FOUND", message: "Transaction inconnue" },
          });
        }

        const amount = new Intl.NumberFormat("fr-SN", {
          style: "currency",
          currency: "XOF",
        }).format(state.amount);
        const callbackUrl = state.metadata.callbackUrl as string;
        const returnUrl = state.metadata.returnUrl as string;
        const method = state.method;

        // Build the webhook body the checkout page will send
        // so we can pre-compute the HMAC signature for both pay/cancel
        const payBody = JSON.stringify({
          providerTransactionId: txId,
          status: "succeeded",
          metadata: { source: "mock_checkout", method },
        });
        const cancelBody = JSON.stringify({
          providerTransactionId: txId,
          status: "failed",
          metadata: {
            source: "mock_checkout",
            method,
            reason: "Paiement annulé par l'utilisateur",
          },
        });
        const paySignature = signWebhookPayload(payBody);
        const cancelSignature = signWebhookPayload(cancelBody);

        // Method-aware branding so the dev preview matches what the user
        // will eventually see in prod. Pure visual — the underlying mock
        // flow is identical for every method.
        const branding = getMockBranding(method);

        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(branding.title)} — Teranga (Test)</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 1rem; }
    .card { background: white; border-radius: 16px; padding: 2rem; max-width: 420px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .brand { background: ${branding.color}; color: white; border-radius: 12px; padding: 1.25rem; text-align: center; margin-bottom: 1.25rem; }
    .brand-logo { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.5px; }
    .brand-sub { font-size: 0.8rem; opacity: 0.9; margin-top: 0.25rem; }
    h1 { font-size: 1.1rem; color: #111; margin-bottom: 0.35rem; text-align: center; }
    .amount { font-size: 2.25rem; font-weight: 800; color: ${branding.color}; margin: 0.75rem 0; text-align: center; letter-spacing: -1px; }
    .desc { color: #555; font-size: 0.9rem; margin-bottom: 1rem; text-align: center; }
    .badge { display: block; width: fit-content; margin: 0 auto 1rem; background: #fef3c7; color: #92400e; padding: 0.3rem 0.8rem; border-radius: 999px; font-size: 0.72rem; font-weight: 600; }
    .row { display: flex; justify-content: space-between; padding: 0.6rem 0; border-top: 1px solid #eee; font-size: 0.85rem; color: #444; }
    .row:first-child { border-top: 0; }
    .row strong { color: #111; font-weight: 600; }
    label { display: block; font-size: 0.8rem; color: #333; font-weight: 600; margin-bottom: 0.35rem; }
    input { width: 100%; padding: 0.75rem; border: 1.5px solid #e5e7eb; border-radius: 10px; font-size: 1rem; outline: none; transition: border-color 0.15s; }
    input:focus { border-color: ${branding.color}; }
    .hint { font-size: 0.72rem; color: #888; margin-top: 0.35rem; }
    .buttons { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1.25rem; }
    button { padding: 0.95rem; border: none; border-radius: 12px; font-size: 0.95rem; font-weight: 700; cursor: pointer; transition: opacity 0.15s, transform 0.1s; }
    button:hover:not(:disabled) { opacity: 0.9; }
    button:active:not(:disabled) { transform: scale(0.99); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .pay { background: ${branding.color}; color: white; }
    .cancel { background: transparent; color: #666; border: 1.5px solid #e5e7eb; }
    .status { margin-top: 1rem; padding: 0.9rem; border-radius: 10px; font-weight: 600; display: none; text-align: center; font-size: 0.9rem; }
    .processing { background: #fef3c7; color: #92400e; }
    .success { background: #dcfce7; color: #166534; }
    .failed { background: #fee2e2; color: #991b1b; }
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-right: 0.35rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <div class="brand-logo">${escapeHtml(branding.logo)}</div>
      <div class="brand-sub">${escapeHtml(branding.subtitle)}</div>
    </div>

    <span class="badge">&#x26a0;&#xfe0f; Environnement de test</span>

    <h1>${escapeHtml(branding.heading)}</h1>
    <p class="desc">${escapeHtml(String(state.metadata.description ?? "Paiement"))}</p>
    <div class="amount">${escapeHtml(amount)}</div>

    <div class="row"><span>Fournisseur</span><strong>${escapeHtml(branding.name)}</strong></div>
    <div class="row"><span>Référence</span><strong>${escapeHtml(txId.slice(0, 18))}&hellip;</strong></div>

    ${
      branding.showPhoneField
        ? `
    <div style="margin-top: 1.25rem;">
      <label for="phone">${escapeHtml(branding.phoneLabel)}</label>
      <input id="phone" type="tel" placeholder="+221 77 123 45 67" value="+221 77 123 45 67" autocomplete="off">
      <p class="hint">Simulation — aucun SMS ni USSD n'est envoyé.</p>
    </div>`
        : ""
    }

    <div class="buttons">
      <button class="pay" id="payBtn" onclick="complete(true)">&#x2713; ${escapeHtml(branding.payLabel)}</button>
      <button class="cancel" id="cancelBtn" onclick="complete(false)">Annuler</button>
    </div>
    <div class="status" id="status"></div>
  </div>
  <script>
    var CONFIG = {
      callbackUrl: '${escapeJs(callbackUrl)}',
      returnUrl: '${escapeJs(returnUrl)}',
      payBody: '${escapeJs(payBody)}',
      cancelBody: '${escapeJs(cancelBody)}',
      paySignature: '${escapeJs(paySignature)}',
      cancelSignature: '${escapeJs(cancelSignature)}',
      processingMsg: '${escapeJs(branding.processingMsg)}'
    };
    function setStatus(cls, text) {
      var el = document.getElementById('status');
      el.style.display = 'block';
      el.className = 'status ' + cls;
      el.innerHTML = text;
    }
    function disable(v) {
      document.getElementById('payBtn').disabled = v;
      document.getElementById('cancelBtn').disabled = v;
    }
    async function complete(success) {
      disable(true);
      if (success) {
        setStatus('processing', '<span class="spinner"></span>' + CONFIG.processingMsg);
        // Simulate realistic mobile-money processing delay (operator ACK)
        await new Promise(function(r){ setTimeout(r, 1200); });
      }
      try {
        var res = await fetch(CONFIG.callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': success ? CONFIG.paySignature : CONFIG.cancelSignature
          },
          body: success ? CONFIG.payBody : CONFIG.cancelBody
        });
        if (res.ok) {
          setStatus(success ? 'success' : 'failed', success ? '&#x2713; Paiement confirmé. Redirection&hellip;' : '&#x2717; Paiement annulé. Redirection&hellip;');
          setTimeout(function() { window.location.href = CONFIG.returnUrl; }, 1200);
        } else {
          setStatus('failed', 'Erreur du serveur. Réessayez.');
          disable(false);
        }
      } catch (e) {
        setStatus('failed', 'Erreur réseau. Réessayez.');
        disable(false);
      }
    }
  </script>
</body>
</html>`;

        return reply.type("text/html").send(html);
      },
    );

    // ─── Mock Checkout Callback (internal) ────────────────────────────────────
    //
    // P1-16 (audit M6) — Zod validation on params + body. Without it,
    // any caller on staging with a known `txId` could send arbitrary
    // shapes that `simulateCallback` would silently process. The
    // validate middleware enforces:
    //   - txId is a non-empty string ≤ 128 chars (matches the mock
    //     provider's internal id format and bounds memory usage),
    //   - body is exactly `{ success: boolean }` — no extra fields,
    //     strict-mode prevents future drift from accidentally
    //     promoting a typo into a working payload.
    const MockCheckoutParams = z.object({
      txId: z.string().min(1).max(128),
    });
    const MockCheckoutCompleteBody = z
      .object({
        success: z.boolean(),
      })
      .strict();

    fastify.post(
      "/mock-checkout/:txId/complete",
      {
        preHandler: [
          validate({ params: MockCheckoutParams, body: MockCheckoutCompleteBody }),
        ],
        schema: {
          tags: ["Payments"],
          summary: "Complete mock checkout (dev only)",
        },
      },
      async (request, reply) => {
        const { txId } = request.params as z.infer<typeof MockCheckoutParams>;
        const body = request.body as z.infer<typeof MockCheckoutCompleteBody>;
        const state = MockPaymentProvider.simulateCallback(txId, body.success);
        if (!state) {
          return reply.status(404).send({
            success: false,
            error: { code: "NOT_FOUND", message: "Transaction inconnue" },
          });
        }
        return reply.send({ success: true, data: { status: state.status } });
      },
    );
  } // end if (config.NODE_ENV !== "production")
};
