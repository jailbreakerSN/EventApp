import { logger } from "firebase-functions/v2";

// ─── Internal dispatch client (Phase 2.3) ──────────────────────────────────
//
// Thin wrapper around `POST /v1/internal/notifications/dispatch` on the
// Cloud Run API. Used by scheduled Cloud Functions (`reminder`, `post-event`,
// `subscription-reminder`, `certificate` triggers) to hand off notification
// fan-out to the API's dispatcher pipeline — catalog lookup, admin override,
// per-key user opt-out, audit log, idempotency dedup.
//
// Why not call the dispatcher directly from Cloud Functions?
//   - The react-email template registry + Resend adapter live in `apps/api/`.
//     Importing them into Functions would either (a) duplicate the bundle
//     (two sources of truth) or (b) break the workspace boundary (Functions
//     would depend on apps/api/*, which isn't a publishable package).
//   - Firestore writes are insufficient — they bypass admin kill-switches,
//     user opt-out, and audit. The dispatcher is the one place that enforces
//     every policy.
//
// ── Auth + network posture ───────────────────────────────────────────────
//
// The endpoint gates on a shared secret (`X-Internal-Dispatch-Secret`) and
// is intended to be reachable ONLY from GCP egress. In production both the
// API Base URL and the shared secret come from Cloud Functions environment
// variables (`API_BASE_URL`, `INTERNAL_DISPATCH_SECRET`). Defaults below
// match the local emulator so `firebase emulators:start` + `npm run api:dev`
// work without extra config.
//
// ── Fire-and-forget contract ─────────────────────────────────────────────
//
// `dispatchInternal` never throws. HTTP errors are logged via
// `firebase-functions/v2/logger` and swallowed — scheduled jobs should keep
// processing the rest of their batch even when the API is briefly
// unreachable. Callers can still observe failure counts via the logger
// output to drive downstream alerting.

export interface InternalDispatchRecipient {
  userId?: string;
  email?: string;
  phone?: string;
  fcmTokens?: string[];
  preferredLocale?: "fr" | "en" | "wo";
}

export interface InternalDispatchRequest {
  key: string;
  recipients: InternalDispatchRecipient[];
  params?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface InternalDispatchClientOptions {
  apiBaseUrl?: string;
  secret?: string;
  /** Override the fetch implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Max time (ms) before aborting the request. Default 10_000. */
  timeoutMs?: number;
}

const DEFAULT_API_BASE_URL =
  process.env.API_BASE_URL?.trim() ||
  // Emulator fallback — matches the Fastify `npm run api:dev` port.
  "http://localhost:3000";

const DEFAULT_SECRET = process.env.INTERNAL_DISPATCH_SECRET?.trim() ?? "";

/**
 * Split an array into chunks of at most `size` items. The internal dispatch
 * endpoint caps recipients at 500 per request — any scheduled job that may
 * exceed that number should run the chunked form via `dispatchInternalChunked`.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * POSTs a single dispatch batch to the API. Returns `{ ok: true }` on 2xx,
 * `{ ok: false, status, message }` on any other outcome (including network
 * errors, timeouts, non-200s). Never throws.
 */
export async function dispatchInternal(
  req: InternalDispatchRequest,
  opts: InternalDispatchClientOptions = {},
): Promise<{ ok: boolean; status?: number; message?: string }> {
  const apiBaseUrl = opts.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const secret = opts.secret ?? DEFAULT_SECRET;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  if (!secret) {
    logger.warn("internal_dispatch: no secret configured; skipping", {
      key: req.key,
      recipients: req.recipients.length,
    });
    return { ok: false, message: "missing_secret" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${apiBaseUrl}/v1/internal/notifications/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Dispatch-Secret": secret,
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        // ignore — status alone is sufficient signal
      }
      logger.error("internal_dispatch: non-2xx response", {
        key: req.key,
        status: res.status,
        body: body.slice(0, 500),
      });
      return { ok: false, status: res.status, message: body.slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    clearTimeout(timer);
    logger.error("internal_dispatch: fetch failed", {
      key: req.key,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fan out a dispatch across chunks of at most 500 recipients. Results are
 * collected into a summary for the caller's logging. Processes chunks
 * sequentially to avoid amplifying the rate-limit cap at the API.
 */
export async function dispatchInternalChunked(
  req: InternalDispatchRequest,
  opts: InternalDispatchClientOptions = {},
): Promise<{ sent: number; failed: number }> {
  if (req.recipients.length === 0) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (const batch of chunk(req.recipients, 500)) {
    const result = await dispatchInternal(
      { ...req, recipients: batch },
      opts,
    );
    if (result.ok) {
      sent += batch.length;
    } else {
      failed += batch.length;
    }
  }
  return { sent, failed };
}
