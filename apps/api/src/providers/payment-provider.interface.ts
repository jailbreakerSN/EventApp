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
}

export interface InitiateResult {
  providerTransactionId: string;
  redirectUrl: string; // URL where user completes payment
}

export interface VerifyResult {
  status: "succeeded" | "failed" | "pending";
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  success: boolean;
  providerRefundId?: string;
  /**
   * When `success === false`, a machine-readable tag that explains why
   * the provider refused the refund. Lets the service layer surface a
   * specific operator-facing message (e.g. "manual refund required")
   * instead of a generic "provider refused" placeholder.
   */
  reason?: "manual_refund_required" | "provider_error";
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
