import { getRequestId } from "@/context/request-context";

/**
 * P1-11 — Structured logger for payment-provider errors.
 *
 * The provider's raw response body MUST stay out of the user-facing
 * `Error.message` (it can carry internal traces, customer phone numbers,
 * provider-internal correlation IDs, …). Providers call this helper to
 * surface the diagnostic to SRE without leaking it to the API client.
 *
 * Output goes to `process.stderr` as a single-line JSON record so it
 * lands in Cloud Run's structured-log sink (Pino-compatible shape) and
 * stays grep-able. We deliberately avoid Fastify's request logger here
 * because providers are pure modules — they don't carry a request handle.
 * Request-context still reaches us via AsyncLocalStorage.
 *
 * The body is truncated to 2 KB to bound log volume on a misbehaving
 * provider that responds with multi-MB HTML error pages.
 */
const MAX_BODY_LEN = 2 * 1024;

export function logProviderError(args: {
  providerName: string;
  /** Logical operation that triggered the error (e.g. `initiate`, `verify`, `refund`, `oauth_token`). */
  operation: string;
  httpStatus: number;
  /** Raw provider body — truncated and serialised; not surfaced to the client. */
  body: string;
  /** Optional payment id for cross-referencing with the Payment record. */
  paymentId?: string;
}): void {
  const truncated =
    args.body.length > MAX_BODY_LEN
      ? `${args.body.slice(0, MAX_BODY_LEN)}…[truncated ${args.body.length - MAX_BODY_LEN}b]`
      : args.body;
  const entry = {
    level: "error",
    msg: "payment_provider_error",
    providerName: args.providerName,
    operation: args.operation,
    httpStatus: args.httpStatus,
    requestId: getRequestId() ?? null,
    paymentId: args.paymentId ?? null,
    body: truncated,
    time: new Date().toISOString(),
  };
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}
