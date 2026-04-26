import { createHash, timingSafeEqual } from "node:crypto";
import { ProviderError } from "@/errors/app-error";
import { logProviderError } from "./provider-error-logger";
import {
  type PaymentProvider,
  type InitiateParams,
  type InitiateResult,
  type RefundResult,
  type VerifyResult,
  type VerifyWebhookParams,
} from "./payment-provider.interface";

/**
 * PayDunya payment provider — the WAEMU-region aggregator that fronts
 * Wave / Orange Money / Free Money / card via a single hosted-checkout
 * endpoint and a single IPN webhook.
 *
 * Phase 2 scope (this file)
 * ─────────────────────────
 *   - Hosted-checkout flow only:
 *       initiate()       → POST /checkout-invoice/create
 *       verify()         → GET  /checkout-invoice/confirm/<token>
 *       refund()         → manual_refund_required (PayDunya has no
 *                          public refund API as of 2026-04)
 *       verifyWebhook()  → SHA-512(MasterKey) constant-time compare
 *                          on the `hash` field inside the IPN payload
 *
 * Out of scope (Phase 3+)
 *   - SOFTPAY direct flow (UI-driven push-payment per wallet).
 *   - Disbursement API (`/api/v2/disburse/*`) — payouts to org wallets.
 *
 * Spec: docs-v2/30-api/providers/paydunya.md
 *
 * Threat model (audit §3.1, T-PD-01..T-PD-07)
 * ────────────────────────────────────────────
 *   T-PD-01  Key leak in logs           → Pino redaction (P1-12) +
 *                                        `logProviderError` body cap
 *   T-PD-02  Webhook replay             → `webhookEvents/<token>`
 *                                        sentinel via `tx.create()`
 *                                        (handled by `payment.service`)
 *   T-PD-03  Payload tampering          → `verifyWebhook()` here +
 *                                        amount + payment_id +
 *                                        providerTransactionId
 *                                        cross-check in service
 *   T-PD-04  Cross-payment via reused
 *            token                      → `Payment.providerTransactionId
 *                                        === payload.invoice.token`
 *                                        invariant (service)
 *   T-PD-05  SSRF via callback_url      → Hard-coded server-side, never
 *                                        from request input
 *   T-PD-06  Double-refund (manual +
 *            auto)                      → Always returns
 *                                        `manual_refund_required`;
 *                                        `refundLocks/<paymentId>`
 *                                        sentinel in the service
 *   T-PD-07  Webhook DDoS                → IP allowlist
 *                                        (PAYDUNYA_WEBHOOK_IPS) +
 *                                        composite-key rate limit
 *                                        (ADR-0015)
 *
 * Env vars
 * ────────
 *   PAYDUNYA_MODE           "sandbox" | "live" — controls base URL
 *   PAYDUNYA_MASTER_KEY     identifies the merchant account (public)
 *   PAYDUNYA_PRIVATE_KEY    server-to-server auth (treat as secret)
 *   PAYDUNYA_TOKEN          additional secret for sensitive ops
 *   PAYDUNYA_STORE_NAME     human label shown on the PayDunya
 *                          checkout page; defaults to "Teranga Events"
 *
 * Cf. `assertProviderSecrets()` for the half-config detection.
 */

const SANDBOX_BASE_URL = "https://app.paydunya.com/sandbox-api/v1";
const LIVE_BASE_URL = "https://app.paydunya.com/api/v1";

function getBaseUrl(): string {
  return process.env.PAYDUNYA_MODE === "live" ? LIVE_BASE_URL : SANDBOX_BASE_URL;
}

function buildHeaders(): Record<string, string> {
  return {
    "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY ?? "",
    "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY ?? "",
    "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN ?? "",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * PayDunya response-code catalog. Numeric strings on 2-4 chars.
 * Mapped to retry / not-found / validation / fatal categories so the
 * service layer can drive its retry policy without parsing the
 * provider-internal slug. See spec §9.
 */
const RETRIABLE_CODES = new Set(["50", "99"]);
const NOT_FOUND_CODES = new Set(["4004", "42"]);

interface CreateInvoiceResponse {
  response_code: string;
  response_text: string;
  description?: string;
  token?: string;
}

interface ConfirmInvoiceResponse {
  response_code: string;
  response_text: string;
  hash?: string;
  invoice?: {
    token: string;
    total_amount: number;
    description: string;
    items?: unknown[];
    taxes?: unknown[];
  };
  custom_data?: Record<string, unknown>;
  status?: string;
  customer?: Record<string, unknown>;
  receipt_url?: string;
  mode?: "test";
  fail_reason?: string | null;
}

/**
 * Status mapping per spec §6.4. Anything unknown defaults to `pending`
 * so a half-known state never short-circuits the reconciliation job.
 */
function mapPayDunyaStatus(status: string | undefined): VerifyResult["status"] {
  switch (status) {
    case "completed":
      return "succeeded";
    case "cancelled":
    case "failed":
    case "expired":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Translate a PayDunya error response into a typed `ProviderError`.
 * Body is logged out-of-band (P1-11 contract) so `Error.message` never
 * carries provider internals.
 */
function fromPayDunyaError(args: {
  operation: string;
  httpStatus: number;
  responseCode?: string;
  responseText?: string;
  body?: string;
  paymentId?: string;
}): ProviderError {
  logProviderError({
    providerName: "paydunya",
    operation: args.operation,
    httpStatus: args.httpStatus,
    body: args.body ?? args.responseText ?? "(no body)",
    paymentId: args.paymentId,
  });
  return new ProviderError({
    providerName: "paydunya",
    httpStatus: args.httpStatus,
    providerCode: args.responseCode,
    retriable: args.responseCode ? RETRIABLE_CODES.has(args.responseCode) : false,
  });
}

export class PayDunyaPaymentProvider implements PaymentProvider {
  readonly name = "paydunya";

  /**
   * Create a hosted-checkout invoice. Returns the `token` (stored in
   * `Payment.providerTransactionId`) and the `redirectUrl` (the
   * PayDunya page the user is sent to).
   *
   * `paymentId` is sent in `custom_data.payment_id` — that's the only
   * reliable identifier when the IPN arrives (the token is also
   * sufficient but `payment_id` lets us cross-check Payment doc
   * existence before any state mutation).
   */
  async initiate(params: InitiateParams): Promise<InitiateResult> {
    const body = {
      invoice: {
        total_amount: params.amount,
        description: params.description,
      },
      store: {
        name: process.env.PAYDUNYA_STORE_NAME ?? "Teranga Events",
      },
      actions: {
        callback_url: params.callbackUrl,
        return_url: params.returnUrl,
        // PayDunya supports a separate `cancel_url` but we point both
        // at the same handler; the participant page distinguishes via
        // the `?paymentId=...&cancelled=true` query string we emit on
        // the cancel branch.
        cancel_url: params.returnUrl,
      },
      custom_data: {
        payment_id: params.paymentId,
        // The user-selected method (`wave` / `orange_money` / …) is a
        // hint to the PayDunya checkout page — it pre-selects that
        // wallet but the user can still switch on PayDunya's UI.
        // Real provider routing happens server-side via the wallet
        // the user actually uses.
        method: params.method ?? null,
      },
    };

    let response: Response;
    try {
      response = await fetch(`${getBaseUrl()}/checkout-invoice/create`, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: unknown) {
      const isTimeout =
        err && typeof err === "object" && "name" in err &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      logProviderError({
        providerName: "paydunya",
        operation: "initiate",
        httpStatus: 0,
        body: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        paymentId: params.paymentId,
      });
      throw new ProviderError({
        providerName: "paydunya",
        httpStatus: 0,
        providerCode: isTimeout ? "network_timeout" : "network_error",
        retriable: true,
      });
    }

    let json: CreateInvoiceResponse;
    try {
      json = (await response.json()) as CreateInvoiceResponse;
    } catch {
      const rawBody = await response.text().catch(() => "");
      throw fromPayDunyaError({
        operation: "initiate.parse",
        httpStatus: response.status,
        body: rawBody.slice(0, 2000),
        paymentId: params.paymentId,
      });
    }

    if (!response.ok || json.response_code !== "00" || !json.token) {
      throw fromPayDunyaError({
        operation: "initiate",
        httpStatus: response.status,
        responseCode: json.response_code,
        responseText: json.response_text,
        paymentId: params.paymentId,
      });
    }

    return {
      providerTransactionId: json.token,
      // PayDunya returns the hosted-checkout URL in `response_text`
      // (their API quirk). Defensive: if a future API version moves
      // it elsewhere, fall back to building the canonical URL from
      // the token.
      redirectUrl:
        /^https?:\/\//.test(json.response_text)
          ? json.response_text
          : `https://paydunya.com/checkout/invoice/${json.token}`,
    };
  }

  /**
   * Reconciliation read — used by the periodic sweeper job (Phase 3)
   * and as a fallback when the IPN is missed. Never on the hot
   * mutation path.
   */
  async verify(providerTransactionId: string): Promise<VerifyResult> {
    let response: Response;
    try {
      response = await fetch(
        `${getBaseUrl()}/checkout-invoice/confirm/${encodeURIComponent(providerTransactionId)}`,
        {
          method: "GET",
          headers: buildHeaders(),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (err: unknown) {
      logProviderError({
        providerName: "paydunya",
        operation: "verify",
        httpStatus: 0,
        body: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      // Reconciliation reads must NEVER throw — the job loops over
      // many payments and one provider blip shouldn't abort the
      // whole batch. Surface as `failed` with metadata; the next
      // sweep retries.
      return {
        status: "failed",
        metadata: { reason: "network_error" },
      };
    }

    let json: ConfirmInvoiceResponse;
    try {
      json = (await response.json()) as ConfirmInvoiceResponse;
    } catch {
      return {
        status: "failed",
        metadata: { reason: "malformed_response", httpStatus: response.status },
      };
    }

    // PayDunya's `4004` and `42` are both "invoice not found / expired"
    // — surface as `failed` so the reconciliation marks the Payment
    // appropriately. NOT thrown so the sweep continues.
    if (json.response_code && NOT_FOUND_CODES.has(json.response_code)) {
      return {
        status: "failed",
        metadata: { reason: "transaction_not_found", responseCode: json.response_code },
      };
    }

    if (json.response_code !== "00") {
      // Genuine provider-side error — log + surface as `failed`.
      logProviderError({
        providerName: "paydunya",
        operation: "verify",
        httpStatus: response.status,
        body: `${json.response_code}: ${json.response_text ?? ""}`,
      });
      return {
        status: "failed",
        metadata: { reason: "provider_error", responseCode: json.response_code },
      };
    }

    return {
      status: mapPayDunyaStatus(json.status),
      metadata: {
        rawStatus: json.status,
        receiptUrl: json.receipt_url,
        // mode === "test" leaks into production logs only when
        // PAYDUNYA_MODE is misconfigured (`live` env var pointing at
        // the sandbox base URL or vice-versa). Surface to operators
        // for forensic alerting.
        mode: json.mode,
      },
    };
  }

  /**
   * PayDunya does not expose a programmatic refund API (as of
   * 2026-04). Always returns `manual_refund_required`; the operator
   * processes the refund via the PayDunya merchant portal and the
   * service layer marks the payment refunded out-of-band.
   *
   * Spec §11. Threat T-PD-06 (double-refund) is mitigated by the
   * `refundLocks/<paymentId>` sentinel + the `manual_refund_required`
   * branch in `payment.service.ts:refundPayment` that throws a
   * dedicated French message ("Contactez votre point de vente …").
   */
  async refund(_providerTransactionId: string, _amount: number): Promise<RefundResult> {
    return { success: false, reason: "manual_refund_required" };
  }

  /**
   * Verify a PayDunya IPN webhook signature.
   *
   * PayDunya sends the IPN as `application/x-www-form-urlencoded`
   * with a single `data` field whose value is a JSON-stringified
   * payload. The payload includes a `hash` field — the SHA-512 of
   * the merchant's MasterKey, hex-encoded — so we recompute the
   * same hash and constant-time compare.
   *
   * Critical implementation notes:
   *   1. The route MUST register a body-parser for the
   *      `application/x-www-form-urlencoded` content-type AND
   *      capture the raw body BEFORE the parser flattens it,
   *      otherwise we lose the `data=` separator that's part of
   *      the wire format. See `paydunya-webhook-bodyparser.ts`.
   *   2. The signature is over the MasterKey, NOT over the body.
   *      That makes it weaker than a per-request HMAC (PayDunya's
   *      design choice), so the `webhookEvents/<token>` idempotency
   *      sentinel + amount/payment_id cross-check are load-bearing
   *      defences (see threat model §3.1).
   *   3. `timingSafeEqual` THROWS on unequal-length buffers — we
   *      length-check FIRST so a malformed signature returns false
   *      cleanly (mirrors P1-25 invariant).
   */
  verifyWebhook(params: VerifyWebhookParams): boolean {
    const masterKey = process.env.PAYDUNYA_MASTER_KEY;
    if (!masterKey || masterKey.trim().length === 0) {
      // Fail-CLOSED when the secret is unset — defence-in-depth on
      // top of the boot assertion (P1-18 extension). See spec §6.2.
      return false;
    }

    const dataStr = extractDataField(params.rawBody);
    if (!dataStr) return false;

    let payload: { hash?: unknown };
    try {
      payload = JSON.parse(dataStr) as { hash?: unknown };
    } catch {
      return false;
    }
    if (typeof payload.hash !== "string" || payload.hash.length === 0) {
      return false;
    }

    const expected = createHash("sha512").update(masterKey).digest("hex");
    let receivedBuf: Buffer;
    let expectedBuf: Buffer;
    try {
      receivedBuf = Buffer.from(payload.hash, "hex");
      expectedBuf = Buffer.from(expected, "hex");
    } catch {
      return false;
    }
    if (receivedBuf.length === 0 || receivedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(receivedBuf, expectedBuf);
  }
}

/**
 * Extract the `data` field from a PayDunya IPN body. The body is
 * `application/x-www-form-urlencoded` with a single key, but we use
 * URLSearchParams rather than a custom parser so quoting + percent-
 * decoding are handled correctly.
 *
 * Exported for tests so the parser contract stays pinned independently
 * of the provider class.
 */
export function extractDataField(rawBody: string): string | null {
  if (typeof rawBody !== "string" || rawBody.length === 0) return null;
  try {
    const params = new URLSearchParams(rawBody);
    const data = params.get("data");
    return data && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

export const paydunyaPaymentProvider = new PayDunyaPaymentProvider();
