/**
 * Abstract payment provider interface.
 *
 * Each provider (Wave, Orange Money, Mock) implements this interface.
 * The PaymentService depends only on this interface, so swapping
 * providers requires zero service-layer changes.
 */
export interface InitiateParams {
  paymentId: string;
  amount: number; // XOF integer, no decimals
  currency: "XOF";
  description: string; // e.g., "Inscription : Conférence Dakar Tech 2026"
  callbackUrl: string; // webhook URL the provider will POST to
  returnUrl: string; // URL to redirect user after payment
  /**
   * The user-selected payment method (wave, orange_money, free_money, card, mock).
   * Mock provider uses this to brand the simulated checkout screen so devs
   * can visually verify which real provider they'd be hitting in prod.
   * Real providers ignore it.
   */
  method?: string;
}

export interface InitiateResult {
  providerTransactionId: string;
  redirectUrl: string; // URL where user completes payment
}

export interface VerifyResult {
  status: "succeeded" | "failed" | "pending";
  metadata?: Record<string, unknown>;
}

/**
 * Discriminated reasons a provider can return when a refund fails.
 * P1-19 (audit M7) — extended from the original
 * `manual_refund_required | provider_error` pair so the operator
 * sees an actionable message (network blip vs. fund issue vs.
 * unsupported operation) instead of the generic "provider refused"
 * placeholder.
 *
 * Mapping contract:
 *   - `manual_refund_required` — provider does not support
 *     programmatic refunds (Orange Money is the canonical case).
 *     Operator must use the merchant portal.
 *   - `insufficient_funds` — provider rejected because the merchant
 *     account has no balance to refund from. Rare but observed on
 *     Wave when the merchant wallet has been swept by a payout
 *     between succeeded → refund.
 *   - `already_refunded` — provider says the source transaction is
 *     already fully refunded (most often a stale lock or a manual
 *     refund applied via the portal). Service should reconcile.
 *   - `transaction_not_found` — provider cannot locate the source
 *     transaction id. Usually a stale `providerTransactionId` after
 *     a provider migration; operator must check the original payment.
 *   - `network_timeout` — fetch timed out before the provider replied.
 *     Retriable; the operator dashboard surfaces a "retry" affordance.
 *   - `provider_error` — anything else (5xx, parsing error, unknown
 *     code). Not retriable from the API path; the operator is paged
 *     via the dashboard alert.
 *
 * INVARIANT: every refund failure path MUST set `reason`. The service
 * layer's "Le remboursement a été refusé par le fournisseur" fallback
 * is a debugging fallback only — never the primary signal.
 */
export type RefundFailureReason =
  | "manual_refund_required"
  | "insufficient_funds"
  | "already_refunded"
  | "transaction_not_found"
  | "network_timeout"
  | "provider_error";

export interface RefundResult {
  success: boolean;
  providerRefundId?: string;
  /**
   * When `success === false`, a machine-readable tag that explains why
   * the provider refused the refund. Lets the service layer surface a
   * specific operator-facing message instead of the generic "provider
   * refused" placeholder. See `RefundFailureReason` for the
   * discriminator contract + mapping rules.
   */
  reason?: RefundFailureReason;
  /**
   * Optional provider-side error code (Wave returns numeric codes,
   * OM returns string slugs). Surfaced to the operator dashboard for
   * forensics; never bubbled into the user-facing message because it
   * may include provider-internal correlation IDs.
   */
  providerCode?: string;
}

/**
 * Input to `verifyWebhook` — the raw request body and whichever header
 * carries the provider's signature/token. Some providers (Orange Money)
 * send the token in an unusual header name, so we pass the full header
 * bag rather than a single `signature` string.
 */
export interface VerifyWebhookParams {
  /** Raw request body as received from the provider. MUST not be re-serialised. */
  rawBody: string;
  /** Lower-cased header map from Fastify. */
  headers: Record<string, string | string[] | undefined>;
}

export interface PaymentProvider {
  readonly name: string;

  /**
   * Create a payment intent with the provider.
   * Returns a redirect URL for the user to complete payment.
   */
  initiate(params: InitiateParams): Promise<InitiateResult>;

  /**
   * Verify a payment status with the provider.
   * Used for manual status checks and reconciliation.
   */
  verify(providerTransactionId: string): Promise<VerifyResult>;

  /**
   * Request a refund from the provider.
   */
  refund(providerTransactionId: string, amount: number): Promise<RefundResult>;

  /**
   * Authenticate an incoming webhook payload. Each provider implements
   * its own signature / token scheme:
   *   - Wave: HMAC-SHA256 of raw body keyed by WAVE_API_SECRET, passed
   *     as `X-Wave-Signature`.
   *   - Orange Money: pre-shared `notif_token` compared constant-time
   *     against the `X-OM-Token` header.
   *   - Mock: HMAC of raw body keyed by PAYMENT_WEBHOOK_SECRET, passed
   *     as `X-Webhook-Signature`. Kept for dev; never enabled in prod.
   *
   * Returning `false` makes the webhook endpoint reject with 403. Do
   * NOT throw on verification failure — the endpoint logs `false` as
   * invalid signature and needs a clean boolean response.
   */
  verifyWebhook(params: VerifyWebhookParams): boolean;
}
