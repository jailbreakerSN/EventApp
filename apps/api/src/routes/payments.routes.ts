import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import {
  paymentService,
  signWebhookPayload,
  getProviderForWebhook,
} from "@/services/payment.service";
import { MockPaymentProvider } from "@/providers/mock-payment.provider";
import { config } from "@/config";
import {
  InitiatePaymentSchema,
  PaymentWebhookSchema,
  PaymentMethodSchema,
  RefundPaymentSchema,
  PaymentQuerySchema,
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
      const result = await paymentService.initiatePayment(
        eventId,
        ticketTypeId,
        method,
        returnUrl,
        request.user!,
      );
      return reply.status(201).send({ success: true, data: result });
    },
  );

  // ─── Provider-specific raw-body parser ────────────────────────────────────
  // Webhook signature verification MUST run over the exact bytes the
  // provider signed. The default Fastify JSON parser reorders keys on
  // re-serialise, breaking HMAC comparisons with Wave/OM. Register a
  // content-type parser scoped to the webhook paths that attaches the
  // raw string to `request.rawBody` AND still parses JSON into
  // `request.body` so the route handlers keep working unchanged.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body: string, done) => {
      try {
        // Only attach rawBody on webhook paths — elsewhere the usual
        // parsed-body flow is what downstream handlers expect.
        if (req.url.startsWith("/webhook/") || req.url === "/webhook") {
          (req as FastifyRequest & { rawBody?: string }).rawBody = body;
        }
        const parsed = body ? JSON.parse(body) : {};
        done(null, parsed);
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
  const ParamsWithProvider = z.object({
    provider: PaymentMethodSchema,
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
      preHandler: [validate({ params: ParamsWithProvider, body: PaymentWebhookSchema })],
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

      const rawBody =
        (request as FastifyRequest & { rawBody?: string }).rawBody ?? JSON.stringify(request.body);

      if (!provider.verifyWebhook({ rawBody, headers: request.headers })) {
        return reply.status(403).send({
          success: false,
          error: { code: "FORBIDDEN", message: "Signature de webhook invalide" },
        });
      }

      const { providerTransactionId, status, metadata } = request.body as z.infer<
        typeof PaymentWebhookSchema
      >;

      try {
        await paymentService.handleWebhook(providerTransactionId, status, metadata);
        return reply.send({ success: true });
      } catch (err: unknown) {
        if (err && typeof err === "object" && "name" in err && err.name === "NotFoundError") {
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
      const rawBody =
        (request as FastifyRequest & { rawBody?: string }).rawBody ?? JSON.stringify(request.body);
      if (!provider.verifyWebhook({ rawBody, headers: request.headers })) {
        return reply.status(403).send({
          success: false,
          error: { code: "FORBIDDEN", message: "Signature de webhook invalide" },
        });
      }
      const { providerTransactionId, status, metadata } = request.body as z.infer<
        typeof PaymentWebhookSchema
      >;
      try {
        await paymentService.handleWebhook(providerTransactionId, status, metadata);
        return reply.send({ success: true });
      } catch (err: unknown) {
        if (err && typeof err === "object" && "name" in err && err.name === "NotFoundError") {
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
    fastify.post(
      "/mock-checkout/:txId/complete",
      {
        schema: {
          tags: ["Payments"],
          summary: "Complete mock checkout (dev only)",
        },
      },
      async (request, reply) => {
        const { txId } = request.params as ParamsWithTxId;
        const body = request.body as { success: boolean };
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
