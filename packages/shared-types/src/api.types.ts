import { z } from "zod";

// ─── Generic API Response Wrappers ────────────────────────────────────────────

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z
      .object({
        page: z.number().int().optional(),
        limit: z.number().int().optional(),
        total: z.number().int().optional(),
        totalPages: z.number().int().optional(),
      })
      .optional(),
  });

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// ─── Pagination ───────────────────────────────────────────────────────────────

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  orderBy: z.string().optional(),
  orderDir: z.enum(["asc", "desc"]).default("desc"),
});

export type PaginationQuery = z.infer<typeof PaginationSchema>;

// ─── Common Error Codes ───────────────────────────────────────────────────────

export const ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  EVENT_FULL: "EVENT_FULL",
  ZONE_FULL: "ZONE_FULL",
  REGISTRATION_CLOSED: "REGISTRATION_CLOSED",
  QR_INVALID: "QR_INVALID",
  QR_ALREADY_USED: "QR_ALREADY_USED",
  QR_EXPIRED: "QR_EXPIRED",
  QR_NOT_YET_VALID: "QR_NOT_YET_VALID",
  ORGANIZATION_PLAN_LIMIT: "ORGANIZATION_PLAN_LIMIT",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ─── Webhook Event Types ──────────────────────────────────────────────────────

export const WebhookEventTypeSchema = z.enum([
  "registration.created",
  "registration.confirmed",
  "registration.cancelled",
  "checkin.success",
  "event.published",
  "event.cancelled",
  "payment.completed",
]);

export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

export const WebhookPayloadSchema = z.object({
  id: z.string(), // unique webhook delivery ID
  type: WebhookEventTypeSchema,
  timestamp: z.string().datetime(),
  organizationId: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// ─── Typed API Response Helpers ──────────────────────────────────────────────
// These TypeScript types (not Zod schemas) are used to type service and route returns.

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  meta: PaginationMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ─── Request DTO Schemas ─────────────────────────────────────────────────────
// Reusable param/body schemas for route validation.

export const IdParamSchema = z.object({
  id: z.string(),
});

export type IdParam = z.infer<typeof IdParamSchema>;
