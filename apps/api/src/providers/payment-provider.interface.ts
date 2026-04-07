/**
 * Abstract payment provider interface.
 *
 * Each provider (Wave, Orange Money, Mock) implements this interface.
 * The PaymentService depends only on this interface, so swapping
 * providers requires zero service-layer changes.
 */
export interface InitiateParams {
  paymentId: string;
  amount: number;           // XOF integer, no decimals
  currency: "XOF";
  description: string;      // e.g., "Inscription : Conférence Dakar Tech 2026"
  callbackUrl: string;      // webhook URL the provider will POST to
  returnUrl: string;        // URL to redirect user after payment
}

export interface InitiateResult {
  providerTransactionId: string;
  redirectUrl: string;      // URL where user completes payment
}

export interface VerifyResult {
  status: "succeeded" | "failed" | "pending";
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  success: boolean;
  providerRefundId?: string;
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
}
