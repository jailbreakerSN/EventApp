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
  // Admin impersonation — upstream Firebase Auth / IAM signing failure.
  // Returned when `auth.createCustomToken` throws on Cloud Run; the root
  // cause is almost always a missing `roles/iam.serviceAccountTokenCreator`
  // binding on the Cloud Run runtime service account.
  IMPERSONATION_SIGNING_UNAVAILABLE: "IMPERSONATION_SIGNING_UNAVAILABLE",
  // Impersonation authorization-code flow — the code presented at
  // /v1/impersonation/exchange does not match any live row. Either the
  // code is malformed, was never issued, or was TTL-purged after its
  // 60-second window. 404-shape; surfaced to the user as a generic
  // "session expirée, recommencez" — we never echo the supplied code.
  IMPERSONATION_CODE_INVALID: "IMPERSONATION_CODE_INVALID",
  // The code exists but its `expiresAt` is in the past. Separate from
  // INVALID so ops can distinguish client clock skew from raw forgery
  // in metrics. 410 Gone.
  IMPERSONATION_CODE_EXPIRED: "IMPERSONATION_CODE_EXPIRED",
  // Single-use guarantee: the code was already redeemed. Either a
  // double-click (harmless — the first exchange will have signed in)
  // or a replay attempt (malicious). 409 Conflict.
  IMPERSONATION_CODE_CONSUMED: "IMPERSONATION_CODE_CONSUMED",
  // Code was issued for a different target app (backoffice vs participant).
  // The browser's Origin header on the exchange request does not match
  // the stored targetOrigin. 403 Forbidden — almost always an attempt
  // to consume a code on a foreign origin (CSRF / open-redirect variant).
  IMPERSONATION_ORIGIN_MISMATCH: "IMPERSONATION_ORIGIN_MISMATCH",
  // Admin job runner (T2.2) — jobKey in the POST path does not match
  // any registered handler. 404 Not Found.
  ADMIN_JOB_NOT_FOUND: "ADMIN_JOB_NOT_FOUND",
  // Single-flight lock is held by a still-running (< 5 min) instance
  // of the same job. Operator should wait or force-unlock from the
  // job-detail view (follow-up PR). 409 Conflict.
  ADMIN_JOB_ALREADY_RUNNING: "ADMIN_JOB_ALREADY_RUNNING",
  // POST body did not match the handler's Zod input schema. Detail
  // carries the Zod flatten output so the UI can highlight the
  // offending field. 400 Bad Request.
  ADMIN_JOB_INVALID_INPUT: "ADMIN_JOB_INVALID_INPUT",
  // Handler exceeded the 5-minute execution budget and was aborted.
  // The run row lands as `status: "failed"` with this code. 504.
  ADMIN_JOB_TIMEOUT: "ADMIN_JOB_TIMEOUT",
  // T2.1 — admin tried to replay / fetch a webhook event that doesn't
  // exist in `webhookEvents` (either never received or TTL-purged
  // after the 90-day retention window). 404.
  WEBHOOK_EVENT_NOT_FOUND: "WEBHOOK_EVENT_NOT_FOUND",
  // T2.3 — API key path errors.
  // Presented bearer doesn't resolve to a live key (bad prefix,
  // checksum fail, or doc not found). 401 — indistinguishable from
  // bad-ID-token on purpose so leaked prefixes can't be enumerated.
  API_KEY_INVALID: "API_KEY_INVALID",
  // Presented key exists but `status === "revoked"`. Split from INVALID
  // for metrics only; same 401 on the wire so callers can't distinguish
  // "revoked" from "never existed".
  API_KEY_REVOKED: "API_KEY_REVOKED",
  // CRUD target doesn't exist. 404 Not Found.
  API_KEY_NOT_FOUND: "API_KEY_NOT_FOUND",
  // Org's plan doesn't include the `apiAccess` feature. 402/403-shape
  // depending on reading — we map to PlanLimitError (403) for
  // consistency with the rest of the plan gates.
  API_KEY_PLAN_LIMIT: "API_KEY_PLAN_LIMIT",
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
