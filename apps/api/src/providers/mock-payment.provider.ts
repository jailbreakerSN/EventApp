import crypto from "crypto";
import { type PaymentProvider, type InitiateParams, type InitiateResult, type VerifyResult, type RefundResult } from "./payment-provider.interface";

/**
 * Mock payment provider for development and testing.
 *
 * Simulates the mobile money flow:
 * 1. `initiate()` stores a pending payment and returns a mock checkout URL
 * 2. The mock checkout page (served by a route) lets the tester click "Payer" or "Annuler"
 * 3. That click hits the webhook endpoint, confirming or failing the payment
 * 4. `verify()` returns the current status from the in-memory store
 *
 * In production, this is replaced by WavePaymentProvider, OrangeMoneyProvider, etc.
 */

interface MockPaymentState {
  status: "pending" | "succeeded" | "failed";
  amount: number;
  metadata: Record<string, unknown>;
}

// In-memory store for mock payment states
const paymentStore = new Map<string, MockPaymentState>();

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    const providerTransactionId = `mock_${crypto.randomBytes(12).toString("hex")}`;

    paymentStore.set(providerTransactionId, {
      status: "pending",
      amount: params.amount,
      metadata: {
        paymentId: params.paymentId,
        description: params.description,
        callbackUrl: params.callbackUrl,
        returnUrl: params.returnUrl,
      },
    });

    // The mock checkout page is served by the API at /v1/payments/mock-checkout/:txId
    const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
    const redirectUrl = `${baseUrl}/v1/payments/mock-checkout/${providerTransactionId}`;

    return { providerTransactionId, redirectUrl };
  }

  async verify(providerTransactionId: string): Promise<VerifyResult> {
    const state = paymentStore.get(providerTransactionId);
    if (!state) {
      return { status: "failed", metadata: { reason: "Transaction inconnue" } };
    }
    return { status: state.status, metadata: state.metadata };
  }

  async refund(providerTransactionId: string, amount: number): Promise<RefundResult> {
    const state = paymentStore.get(providerTransactionId);
    if (!state || state.status !== "succeeded") {
      return { success: false };
    }
    // Don't change status here — PaymentService handles status transitions
    state.metadata.refundedAmount = amount;
    return { success: true, providerRefundId: `mock_refund_${crypto.randomBytes(6).toString("hex")}` };
  }

  /**
   * Simulate a payment completion (called by mock checkout route).
   * In production, this is handled by the provider's webhook.
   */
  static simulateCallback(providerTransactionId: string, success: boolean): MockPaymentState | null {
    const state = paymentStore.get(providerTransactionId);
    if (!state) return null;
    state.status = success ? "succeeded" : "failed";
    return state;
  }

  /** Get mock payment state (for the checkout page) */
  static getState(providerTransactionId: string): MockPaymentState | null {
    return paymentStore.get(providerTransactionId) ?? null;
  }
}

export const mockPaymentProvider = new MockPaymentProvider();
