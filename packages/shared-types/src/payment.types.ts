import { z } from "zod";

// ─── Payment Status ──────────────────────────────────────────────────────────

export const PaymentStatusSchema = z.enum([
  "pending",       // created, awaiting provider redirect
  "processing",    // user redirected to provider, awaiting callback
  "succeeded",     // payment confirmed by provider
  "failed",        // payment rejected or errored
  "refunded",      // payment refunded (full or partial)
  "expired",       // payment timed out
]);

export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

// ─── Payment Method ──────────────────────────────────────────────────────────

export const PaymentMethodSchema = z.enum([
  "wave",          // Wave mobile money (Senegal #1)
  "orange_money",  // Orange Money
  "free_money",    // Free Money
  "card",          // Card via Stripe/PayDunya
  "mock",          // Mock provider for testing
]);

export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

// ─── Payment Document ────────────────────────────────────────────────────────

export const PaymentSchema = z.object({
  id: z.string(),
  registrationId: z.string(),
  eventId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  amount: z.number().int().positive(),       // XOF — no decimals
  currency: z.literal("XOF"),
  method: PaymentMethodSchema,
  providerTransactionId: z.string().nullable(),
  status: PaymentStatusSchema,
  redirectUrl: z.string().nullable(),        // URL where user pays
  callbackUrl: z.string().nullable(),        // webhook URL for provider
  returnUrl: z.string().nullable(),          // URL after payment
  providerMetadata: z.record(z.unknown()).nullable(), // raw provider data
  failureReason: z.string().nullable(),
  refundedAmount: z.number().int().default(0),
  initiatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Payment = z.infer<typeof PaymentSchema>;

// ─── Request Schemas ─────────────────────────────────────────────────────────

export const InitiatePaymentSchema = z.object({
  eventId: z.string(),
  ticketTypeId: z.string(),
  method: PaymentMethodSchema.default("mock"),
  returnUrl: z.string().url().refine(
    (url) => /^https?:\/\//i.test(url),
    "L'URL de retour doit utiliser le protocole HTTP ou HTTPS",
  ).optional(),
});

export type InitiatePaymentDto = z.infer<typeof InitiatePaymentSchema>;

export const PaymentWebhookSchema = z.object({
  providerTransactionId: z.string(),
  status: z.enum(["succeeded", "failed"]),
  metadata: z.record(z.unknown()).optional(),
});

export type PaymentWebhookDto = z.infer<typeof PaymentWebhookSchema>;

export const RefundPaymentSchema = z.object({
  amount: z.number().int().positive().optional(), // if omitted, full refund
  reason: z.string().max(500).optional(),
});

export type RefundPaymentDto = z.infer<typeof RefundPaymentSchema>;

// ─── Payment Summary (for backoffice dashboard) ──────────────────────────────

export const PaymentSummarySchema = z.object({
  totalRevenue: z.number().int(),
  totalRefunded: z.number().int(),
  netRevenue: z.number().int(),
  paymentCount: z.number().int(),
  byStatus: z.record(PaymentStatusSchema, z.number().int()),
  byMethod: z.record(PaymentMethodSchema, z.number().int()),
});

export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;

// ─── Payment Query ───────────────────────────────────────────────────────────

export const PaymentQuerySchema = z.object({
  status: PaymentStatusSchema.optional(),
  method: PaymentMethodSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PaymentQuery = z.infer<typeof PaymentQuerySchema>;

// ─── Receipt ────────────────────────────────────────────────────────────────

export const ReceiptSchema = z.object({
  id: z.string(),
  receiptNumber: z.string(),              // e.g. "REC-2026-000001"
  paymentId: z.string(),
  registrationId: z.string(),
  eventId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  amount: z.number().int().positive(),
  currency: z.literal("XOF"),
  method: PaymentMethodSchema,
  eventTitle: z.string(),
  ticketTypeName: z.string(),
  participantName: z.string(),
  participantEmail: z.string().nullable(),
  organizationName: z.string(),
  issuedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type Receipt = z.infer<typeof ReceiptSchema>;

// ─── Payout ─────────────────────────────────────────────────────────────────

export const PayoutStatusSchema = z.enum([
  "pending",       // calculated, awaiting processing
  "processing",    // payout in progress
  "completed",     // money transferred
  "failed",        // payout failed
]);

export type PayoutStatus = z.infer<typeof PayoutStatusSchema>;

export const PayoutSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  eventId: z.string(),
  totalAmount: z.number().int(),         // gross revenue
  platformFee: z.number().int(),         // platform cut
  platformFeeRate: z.number(),           // e.g. 0.05 for 5%
  netAmount: z.number().int(),           // totalAmount - platformFee
  status: PayoutStatusSchema,
  paymentIds: z.array(z.string()),       // payments included
  periodFrom: z.string().datetime(),
  periodTo: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Payout = z.infer<typeof PayoutSchema>;

export const CreatePayoutSchema = z.object({
  eventId: z.string(),
  periodFrom: z.string().datetime(),
  periodTo: z.string().datetime(),
});

export type CreatePayoutDto = z.infer<typeof CreatePayoutSchema>;

export const PayoutQuerySchema = z.object({
  status: PayoutStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PayoutQuery = z.infer<typeof PayoutQuerySchema>;
