import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import {
  paymentService,
  verifyWebhookSignature,
  signWebhookPayload,
} from "@/services/payment.service";
import { MockPaymentProvider } from "@/providers/mock-payment.provider";
import {
  InitiatePaymentSchema,
  PaymentWebhookSchema,
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

export const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Initiate Payment ─────────────────────────────────────────────────────
  fastify.post(
    "/initiate",
    {
      preHandler: [
        authenticate,
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

  // ─── Webhook (no auth — called by payment provider) ───────────────────────
  // Verifies HMAC-SHA256 signature via X-Webhook-Signature header.
  // Mock checkout page sends a valid signature; real providers use their own.
  fastify.post(
    "/webhook",
    {
      preHandler: [validate({ body: PaymentWebhookSchema })],
      schema: {
        tags: ["Payments"],
        summary: "Payment provider webhook callback",
      },
    },
    async (request, reply) => {
      // Verify webhook signature
      const signature = request.headers["x-webhook-signature"] as string | undefined;
      if (!signature) {
        return reply.status(401).send({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Signature de webhook manquante" },
        });
      }

      const rawBody = JSON.stringify(request.body);
      if (!verifyWebhookSignature(rawBody, signature)) {
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

  // ─── Mock Checkout Routes (dev/test only) ─────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
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
          return reply
            .status(404)
            .send({
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

        // Build the webhook body the checkout page will send
        // so we can pre-compute the HMAC signature for both pay/cancel
        const payBody = JSON.stringify({
          providerTransactionId: txId,
          status: "succeeded",
          metadata: { source: "mock_checkout" },
        });
        const cancelBody = JSON.stringify({
          providerTransactionId: txId,
          status: "failed",
          metadata: { source: "mock_checkout" },
        });
        const paySignature = signWebhookPayload(payBody);
        const cancelSignature = signWebhookPayload(cancelBody);

        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paiement — Teranga (Test)</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: white; border-radius: 16px; padding: 2rem; max-width: 400px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.1); text-align: center; }
    .logo { font-size: 2rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; color: #333; margin-bottom: 0.5rem; }
    .amount { font-size: 2rem; font-weight: 700; color: #16a34a; margin: 1rem 0; }
    .desc { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .badge { display: inline-block; background: #fef3c7; color: #92400e; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; margin-bottom: 1.5rem; }
    .buttons { display: flex; gap: 1rem; }
    button { flex: 1; padding: 0.875rem; border: none; border-radius: 12px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
    button:hover { opacity: 0.85; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .pay { background: #16a34a; color: white; }
    .cancel { background: #ef4444; color: white; }
    .status { margin-top: 1rem; padding: 0.75rem; border-radius: 8px; font-weight: 500; display: none; }
    .success { background: #dcfce7; color: #166534; }
    .failed { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">&#x1f3e6;</div>
    <h1>Paiement Mobile Money</h1>
    <div class="badge">&#x26a0;&#xfe0f; Environnement de test</div>
    <p class="desc">${escapeHtml(String(state.metadata.description ?? "Paiement"))}</p>
    <div class="amount">${escapeHtml(amount)}</div>
    <div class="buttons">
      <button class="pay" id="payBtn" onclick="complete(true)">&#x2713; Payer</button>
      <button class="cancel" id="cancelBtn" onclick="complete(false)">&#x2717; Annuler</button>
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
      cancelSignature: '${escapeJs(cancelSignature)}'
    };
    async function complete(success) {
      document.getElementById('payBtn').disabled = true;
      document.getElementById('cancelBtn').disabled = true;
      var el = document.getElementById('status');
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
          el.style.display = 'block';
          el.className = 'status ' + (success ? 'success' : 'failed');
          el.textContent = success ? 'Paiement confirmé !' : 'Paiement annulé.';
          setTimeout(function() { window.location.href = CONFIG.returnUrl; }, 1500);
        } else {
          el.style.display = 'block';
          el.className = 'status failed';
          el.textContent = 'Erreur du serveur. Réessayez.';
          document.getElementById('payBtn').disabled = false;
          document.getElementById('cancelBtn').disabled = false;
        }
      } catch (e) {
        el.style.display = 'block';
        el.className = 'status failed';
        el.textContent = 'Erreur réseau. Réessayez.';
        document.getElementById('payBtn').disabled = false;
        document.getElementById('cancelBtn').disabled = false;
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
          return reply
            .status(404)
            .send({
              success: false,
              error: { code: "NOT_FOUND", message: "Transaction inconnue" },
            });
        }
        return reply.send({ success: true, data: { status: state.status } });
      },
    );
  } // end if (NODE_ENV !== "production")
};
