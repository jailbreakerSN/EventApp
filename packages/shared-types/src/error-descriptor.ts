/**
 * Normalised shape any UI layer can rely on when handling an API error.
 * Mirrors the response body produced by the Fastify global error handler:
 *   `{ success: false, error: { code, message, details? } }`
 * plus anything the ApiError throwers in each app tack on (status, etc.).
 *
 * Callers never assume `code` is in the ERROR_CODES union — unknown codes
 * fall back to `INTERNAL_ERROR` display, but the raw string is preserved
 * so observability (Sentry tags, breadcrumbs) stays faithful.
 */
export interface ErrorDescriptor {
  /** API error code or "UNKNOWN" when the error lacks a structured code. */
  code: string;
  /** Optional disambiguator, e.g. `"event_cancelled"` for REGISTRATION_CLOSED. */
  reason?: string;
  /** HTTP status when available (client fetch error) — undefined otherwise. */
  status?: number;
  /** Raw server message if any. Do NOT show verbatim to end users. */
  message?: string;
  /** Original details object as returned by the API (left untyped). */
  details?: Record<string, unknown>;
  /** Whether the error has a structured code (vs a thrown Error without one). */
  hasCode: boolean;
}

interface RawErrorShape {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
  details?: unknown;
}

/**
 * Best-effort extraction of an ErrorDescriptor from anything that might
 * have been caught in a `catch`. Handles the ApiError thrown by the
 * web API clients, plain `Error` objects, server response payloads, and
 * already-serialised error bodies.
 */
export function extractErrorDescriptor(error: unknown): ErrorDescriptor {
  if (error == null || typeof error !== "object") {
    return { code: "UNKNOWN", hasCode: false };
  }

  const raw = error as RawErrorShape;
  const nestedError = (raw as { error?: unknown }).error as RawErrorShape | undefined;
  const source = nestedError && typeof nestedError === "object" ? nestedError : raw;

  const code = typeof source.code === "string" && source.code.length > 0 ? source.code : "UNKNOWN";
  const status =
    typeof source.status === "number"
      ? source.status
      : typeof source.statusCode === "number"
        ? source.statusCode
        : undefined;
  const message = typeof source.message === "string" ? source.message : undefined;
  const details =
    source.details && typeof source.details === "object"
      ? (source.details as Record<string, unknown>)
      : undefined;
  const reason =
    details && typeof details.reason === "string" ? (details.reason as string) : undefined;

  return {
    code,
    reason,
    status,
    message,
    details,
    hasCode: code !== "UNKNOWN",
  };
}

/**
 * Severity of the error for the UI. Chosen from the descriptor — used by
 * `<InlineErrorBanner>` to pick the icon + tone, and by the toaster fallback.
 */
export type ErrorSeverity = "destructive" | "warning" | "info";

const WARNING_CODES = new Set([
  "REGISTRATION_CLOSED",
  "EVENT_FULL",
  "EMAIL_NOT_VERIFIED",
  "ORGANIZATION_PLAN_LIMIT",
  "QR_NOT_YET_VALID",
  "RATE_LIMIT_EXCEEDED",
]);

const INFO_CODES = new Set(["CONFLICT"]);

/**
 * Rule of thumb:
 * - 4xx the user can fix or wait out  → warning
 * - 4xx user must resolve              → destructive
 * - 5xx / unknown                      → destructive
 * - Already-in-state conflicts         → info
 */
export function severityFor(descriptor: ErrorDescriptor): ErrorSeverity {
  if (INFO_CODES.has(descriptor.code)) return "info";
  if (WARNING_CODES.has(descriptor.code)) return "warning";
  return "destructive";
}
