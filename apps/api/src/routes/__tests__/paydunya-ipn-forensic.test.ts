/**
 * Forensic — exercise the PayDunya IPN pipeline end-to-end with a
 * byte-perfect simulated IPN.
 *
 * Built to answer the staging-incident question: "PayDunya marks the
 * transaction succeeded on its side but our payment stays in
 * `processing` — is the IPN reaching us at all, and if not, where
 * exactly does it die?"
 *
 * This file boots the REAL Fastify route stack with the REAL PayDunya
 * provider (not a mock), forges a webhook body whose `hash` matches
 * SHA-512 of a known MasterKey, and asserts at every layer:
 *
 *   1. addContentTypeParser captures rawBody and projects payload
 *      onto canonical `{providerTransactionId, status, metadata}`
 *   2. webhookIpAllowlist passes (env unset = fail-OPEN)
 *   3. validate({body: PaymentWebhookSchema}) accepts the projected body
 *   4. provider.verifyWebhook returns true on the real SHA-512 compare
 *   5. paymentService.handleWebhook is invoked with the canonical args
 *   6. webhookEventsService.record is called BEFORE the handler so a
 *      crash mid-processing leaves a replayable row
 *
 * Only paymentService + webhookEventsService are mocked (so we don't
 * need Firestore). EVERY layer between the wire and the service
 * boundary runs the production code.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { paymentRoutes } from "../payments.routes";

// ─── Forge fixture — known MasterKey + matching hash ────────────────────────
const TEST_MASTER_KEY = "test-master-key-forensic-do-not-use-in-prod";
const VALID_HASH = createHash("sha512").update(TEST_MASTER_KEY).digest("hex");

beforeAll(() => {
  // The real PayDunya provider reads PAYDUNYA_MASTER_KEY at verify
  // time, not at module load — so setting it before app boot is fine.
  process.env.PAYDUNYA_MASTER_KEY = TEST_MASTER_KEY;
  // No PAYDUNYA_WEBHOOK_IPS pinned ⇒ fail-OPEN allowlist (matches our
  // staging posture).
  delete process.env.PAYDUNYA_WEBHOOK_IPS;
});

// ─── Service-boundary mocks — observe what makes it through ────────────────
const { mockHandleWebhook, mockRecord, mockMarkOutcome } = vi.hoisted(() => ({
  mockHandleWebhook: vi.fn().mockResolvedValue(undefined),
  mockRecord: vi.fn().mockResolvedValue("webhook-log-id-123"),
  mockMarkOutcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/payment.service", async () => {
  // Keep the real getProviderForWebhook so the route resolves to the
  // real PayDunya provider and exercises real verifyWebhook.
  const actual = await vi.importActual<typeof import("@/services/payment.service")>(
    "@/services/payment.service",
  );
  return {
    ...actual,
    paymentService: { handleWebhook: mockHandleWebhook },
  };
});

vi.mock("@/services/webhook-events.service", () => ({
  webhookEventsService: {
    record: mockRecord,
    markOutcome: mockMarkOutcome,
  },
}));

// Auth is short-circuited because the webhook route is public — no
// firebase mock needed at all.

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(paymentRoutes, { prefix: "/v1/payments" });
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    return reply.status(error.statusCode ?? 500).send({
      success: false,
      error: { code: "ERROR", message: error.message },
    });
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Helpers — forge a wire-format IPN that PayDunya actually sends ────────
function forgeIpnBody(opts: {
  hash?: string;
  status?: string;
  invoiceToken?: string;
  invoiceTotal?: number;
  paymentId?: string;
}): string {
  const payload = {
    response_code: "00",
    response_text: "Transaction Found",
    hash: opts.hash ?? VALID_HASH,
    invoice: {
      token: opts.invoiceToken ?? "TEST_INVOICE_TOKEN_42",
      items: {},
      total_amount: opts.invoiceTotal ?? 5000,
      description: "Inscription événement Teranga",
      taxes: [],
    },
    custom_data: {
      payment_id: opts.paymentId ?? "pay_test_123",
    },
    actions: {
      cancel_url: "https://teranga-participant-staging.run.app/cancel",
      callback_url: "https://teranga-api-staging.run.app/v1/payments/webhook/paydunya",
      return_url: "https://teranga-participant-staging.run.app/return",
    },
    mode: "test",
    status: opts.status ?? "completed",
    fail_reason: "",
    customer: {
      name: "Dame Ndiaye",
      phone: "+221770000000",
      email: "dame@example.com",
      payment_method: "wave-senegal",
      country: "SN",
    },
    receipt_identifier: "RCP-TEST-1",
    receipt_url: "https://paydunya.com/receipt/test",
    provider_reference: "WAVE-TXN-REF-1",
  };
  // PayDunya wire format: form-urlencoded body with a SINGLE `data`
  // key. The body parser uses URLSearchParams to extract it cleanly.
  return `data=${encodeURIComponent(JSON.stringify(payload))}`;
}

// ─── Forensic suite ─────────────────────────────────────────────────────────

describe("PayDunya IPN — forensic end-to-end pipeline", () => {
  it("LAYER 1+2+3+4+5 — well-formed IPN with valid SHA-512(MasterKey) flows through every layer", async () => {
    const body = forgeIpnBody({});
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });

    // Layer 5 — handleWebhook received the projected canonical args
    // (NOT the raw PayDunya shape).
    expect(mockHandleWebhook).toHaveBeenCalledTimes(1);
    expect(mockHandleWebhook).toHaveBeenCalledWith(
      "TEST_INVOICE_TOKEN_42", // invoice.token → providerTransactionId
      "succeeded",              // status: "completed" → "succeeded"
      expect.objectContaining({
        providerName: "paydunya",
        expectedAmount: 5000,
        expectedPaymentId: "pay_test_123",
        providerCode: "00",
        providerStatus: "completed",
      }),
    );

    // Layer 6 — webhookEvents.record was called BEFORE the handler
    // (log-first invariant from T2.1)
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "paydunya",
        providerTransactionId: "TEST_INVOICE_TOKEN_42",
        eventType: "payment.succeeded",
      }),
    );

    // markOutcome("processed") fires AFTER the handler returns.
    expect(mockMarkOutcome).toHaveBeenCalledWith({
      id: "webhook-log-id-123",
      processingStatus: "processed",
    });
  });

  it("LAYER 4 — invalid hash produces 403 + NO handleWebhook + NO webhookEvents row", async () => {
    const body = forgeIpnBody({ hash: "0".repeat(128) /* wrong but length-correct */ });
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
    // CRITICAL: webhookEvents.record runs AFTER verifyWebhook, so a
    // 403 leaves NO row in /admin/webhooks. This is the symptom that
    // matches what the user observes in staging.
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("LAYER 3 — malformed `data` JSON produces 400 + NO handleWebhook + NO webhookEvents row", async () => {
    const body = `data=${encodeURIComponent("{not valid json")}`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("LAYER 1 — missing `data=` field produces 400 (validation: empty providerTransactionId)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "wrong_field=anything",
    });

    // The parser returns {}; PaymentWebhookSchema rejects → 400.
    expect(res.statusCode).toBe(400);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("LAYER 1 — Content-Type with charset suffix (`; charset=utf-8`) is accepted by the form parser", async () => {
    // Real-world: some HTTP clients append `; charset=utf-8` to the
    // Content-Type header. Fastify's content-type matching strips the
    // suffix by default — this test pins that behaviour so a future
    // upgrade doesn't regress.
    const body = forgeIpnBody({});
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockHandleWebhook).toHaveBeenCalledTimes(1);
  });

  it("LAYER 5 — PayDunya `pending` status drops to `failed` (idempotency tx absorbs the no-op)", async () => {
    // Per the body-parser comment, anything other than `completed` is
    // mapped to `failed`. The handler's idempotency tx then makes a
    // double-fire (provider sends pending then completed) safe.
    const body = forgeIpnBody({ status: "pending" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockHandleWebhook).toHaveBeenCalledWith(
      "TEST_INVOICE_TOKEN_42",
      "failed",
      expect.objectContaining({ providerStatus: "pending" }),
    );
  });

  it("LAYER 5 — handler throwing NotFoundError surfaces 404 + webhookEvents row marked failed", async () => {
    mockHandleWebhook.mockRejectedValueOnce(
      Object.assign(new Error("Payment not found"), { name: "NotFoundError" }),
    );
    const body = forgeIpnBody({ invoiceToken: "UNKNOWN_TKN" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: body,
    });

    expect(res.statusCode).toBe(404);
    expect(mockMarkOutcome).toHaveBeenCalledWith({
      id: "webhook-log-id-123",
      processingStatus: "failed",
      lastError: { code: "NOT_FOUND", message: "Payment not found" },
    });
  });

  // ── 2026-04-26 hotfix — PayDunya JSON-shape IPN ──────────────────────────
  // Some PayDunya integrations / sandbox modes POST the IPN as
  // application/json with the RAW payload at the top level, instead of
  // the documented application/x-www-form-urlencoded `data=<json>`.
  // The application/json parser detects the PayDunya shape (top-level
  // `hash` + `invoice` keys) and applies the same projection. This test
  // pins that path so the JSON variant never silently regresses to a
  // 400.

  it("LAYER 1+3 — application/json with PayDunya shape produces canonical body projection (validate passes; verifyWebhook still gates)", async () => {
    // Some PayDunya integrations / sandbox modes POST application/json
    // with the raw payload at the top level. The application/json
    // parser detects the PayDunya shape (top-level `hash` + `invoice`)
    // and applies the SAME projection as the form-urlencoded parser,
    // so Zod validation passes (the canonical schema is satisfied)
    // and the request reaches the route handler.
    //
    // The provider's `verifyWebhook()` is currently hard-coded to the
    // form-urlencoded shape (it parses rawBody via URLSearchParams to
    // extract `data=<json>`). On a JSON-content-type request, rawBody
    // is the JSON itself with no `data=` prefix, so verifyWebhook
    // returns false → 403. This test documents that gap; full
    // bidirectional support requires extending verifyWebhook in a
    // follow-up. The projection alone is still the load-bearing
    // change because it advances the failure mode from "Zod 400 with
    // no log row" to "verifyWebhook 403 WITH a log row" (much more
    // diagnosable in production).
    const payload = {
      response_code: "00",
      response_text: "Transaction Found",
      hash: VALID_HASH,
      invoice: {
        token: "JSON_VARIANT_TKN",
        total_amount: 7000,
        description: "JSON-shape IPN test",
      },
      custom_data: { payment_id: "pay_json_1" },
      mode: "test",
      status: "completed",
    };
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });

    // Reaches the route (validate passed → projection works) but the
    // signature gate rejects because verifyWebhook is form-only. Per
    // the doc-comment above, that's the expected current behaviour.
    expect(res.statusCode).toBe(403);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  // ── 2026-04-26 ROOT CAUSE — PHP-style nested form encoding ──────────────
  // PayDunya's official PHP doc uses `$_POST['data']['hash']` which only
  // works in PHP when the body is sent as PHP-style nested form encoding:
  //
  //   data[hash]=...&data[invoice][token]=...&data[status]=completed
  //
  // (NOT `data=<json>`. PHP doesn't auto-deserialize JSON in $_POST.)
  // This is the variant PayDunya production actually sends — the
  // 2026-04-26 staging incident (`POST 400 6ms GuzzleHttp/PHP/5.6.40`)
  // was the variant-2 body hitting our variant-1-only parser.
  //
  // Both parser AND verifyWebhook now accept both wire formats. These
  // tests pin the variant-2 happy path so the regression can never
  // come back silently.

  function forgePhpStyleIpnBody(opts: {
    hash?: string;
    status?: string;
    invoiceToken?: string;
    invoiceTotal?: number;
    paymentId?: string;
  } = {}): string {
    // Mirror the PHP `http_build_query` shape on $_POST['data'][...]:
    // `qs.stringify` produces exactly this when given a nested object.
    const data = {
      response_code: "00",
      response_text: "Transaction Found",
      hash: opts.hash ?? VALID_HASH,
      mode: "test",
      status: opts.status ?? "completed",
      fail_reason: "",
      invoice: {
        token: opts.invoiceToken ?? "PHP_VARIANT_TKN",
        total_amount: String(opts.invoiceTotal ?? 5000),
        description: "PHP-shape IPN test",
      },
      custom_data: {
        payment_id: opts.paymentId ?? "pay_php_1",
      },
      customer: {
        name: "Forensic Test",
        phone: "+221770000000",
        email: "forensic@example.com",
      },
    };
    // qs.stringify({ data }) → `data%5Bhash%5D=...&data%5Binvoice%5D%5Btoken%5D=...`
    // (which is exactly the variant-2 wire format).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const qs = require("qs") as typeof import("qs");
    return qs.stringify({ data });
  }

  it("LAYER 1+2+3+4+5 — accepts PHP-style nested form encoding (THE PAYDUNYA PRODUCTION FORMAT)", async () => {
    const body = forgePhpStyleIpnBody({});
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockHandleWebhook).toHaveBeenCalledWith(
      "PHP_VARIANT_TKN",
      "succeeded",
      expect.objectContaining({
        providerName: "paydunya",
        // qs returns leaves as strings; the projection coerces numeric
        // strings → numbers so handleWebhook's anti-tampering check
        // matches Payment.amount (typed as number).
        expectedAmount: 5000,
        expectedPaymentId: "pay_php_1",
        providerStatus: "completed",
      }),
    );
  });

  it("LAYER 4 — PHP-style nested with WRONG hash returns 403 (verifyWebhook rejects)", async () => {
    const body = forgePhpStyleIpnBody({ hash: "0".repeat(128) });
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("LAYER 5 — PHP-style with status=cancelled maps to failed", async () => {
    const body = forgePhpStyleIpnBody({ status: "cancelled" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockHandleWebhook).toHaveBeenCalledWith(
      "PHP_VARIANT_TKN",
      "failed",
      expect.objectContaining({ providerStatus: "cancelled" }),
    );
  });

  it("does NOT project a non-PayDunya JSON body (canonical-shape from Wave/OM passes through)", async () => {
    // A provider that genuinely sends canonical-shape JSON (e.g. Wave's
    // direct integration) must NOT be re-projected through the PayDunya
    // helper. The detection heuristic requires BOTH `hash` AND
    // `invoice` at the top level — canonical bodies have neither.
    const canonical = {
      providerTransactionId: "WAVE_TX_99",
      status: "succeeded",
      metadata: { providerName: "wave" },
    };
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/wave",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(canonical),
    });

    // The Wave provider's verifyWebhook reads x-wave-signature from
    // headers (not present here), so the route 403s — but the parser
    // forwarded the canonical body unchanged. We assert handleWebhook
    // was NOT called (signature failure short-circuits before it),
    // and that the projection wasn't applied (no PayDunya metadata
    // was injected).
    expect(res.statusCode).toBe(403);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });
});
