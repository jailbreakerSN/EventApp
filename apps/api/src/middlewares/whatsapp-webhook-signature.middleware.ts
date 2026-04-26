/**
 * Meta WhatsApp Cloud API webhook signature verification.
 *
 * Meta signs every webhook delivery with HMAC-SHA256 over the raw
 * request body, keyed by the App Secret. The signature is sent in
 * the `X-Hub-Signature-256` header in the form `sha256=<hex>`.
 *
 * Production posture (fail-CLOSED):
 *   - `WHATSAPP_APP_SECRET` is set → reject any request whose
 *     signature doesn't match in constant-time.
 *
 * Dev posture (fail-OPEN):
 *   - `WHATSAPP_APP_SECRET` is NOT set → middleware is a no-op.
 *     This matches the existing IP-allowlist middleware's
 *     fail-OPEN-when-unconfigured posture: the Meta homologation
 *     pipeline takes weeks and the staging environment uses the
 *     mock transport with no inbound webhook traffic.
 *
 * The middleware reads `request.rawBody` populated by the JSON
 * content-type parser in `payments.routes.ts` (extended to match
 * `/webhooks?/` so this route is also covered).
 *
 * Why constant-time:
 *   `crypto.timingSafeEqual` defeats the timing oracle that lets
 *   an attacker recover the signature byte-by-byte by measuring the
 *   string-compare's early-exit characteristics.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError, ValidationError } from "@/errors/app-error";

const HEADER_NAME = "x-hub-signature-256";
const SIGNATURE_PREFIX = "sha256=";

interface RequestWithRawBody extends FastifyRequest {
  rawBody?: string;
}

/**
 * Pure helper: does the supplied signature match the expected HMAC
 * for `(secret, rawBody)`? Exported for unit tests so the
 * verification math can be pinned without spinning up Fastify.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || typeof signatureHeader !== "string") return false;
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;
  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length);
  // Hex digest of HMAC-SHA256 = 64 chars. Anything else is malformed.
  if (provided.length !== 64) return false;
  if (!/^[0-9a-f]+$/i.test(provided)) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Lengths are identical by construction (both 64-char hex), but
  // we still gate the constant-time compare on length match —
  // `timingSafeEqual` throws if its two buffers differ in length.
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided.toLowerCase()));
}

/**
 * Fastify preHandler. Extracts `rawBody` (populated by the
 * content-type parser registered in `payments.routes.ts`) and the
 * `X-Hub-Signature-256` header, then verifies via the pure helper.
 *
 * On verification failure: throws `ForbiddenError`. On a missing
 * `rawBody` (programming error: the parser didn't populate it):
 * throws `ValidationError` so the misconfiguration surfaces loudly.
 *
 * In dev / staging where `WHATSAPP_APP_SECRET` is unset, the
 * middleware no-ops so the mock transport keeps working.
 */
export async function whatsappWebhookSignature(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || secret.trim().length === 0) {
    // Fail-OPEN — same posture as the IP allowlist when its env var
    // is unset. Both gates being absent in dev is the expected path.
    return;
  }

  const req = request as RequestWithRawBody;
  if (typeof req.rawBody !== "string") {
    // Programming error: the JSON content-type parser must run
    // before this preHandler. If rawBody is missing we cannot verify,
    // so we MUST reject — silently no-opping would let an attacker
    // bypass verification by triggering whatever path drops the body
    // capture (e.g. wrong Content-Type).
    throw new ValidationError(
      "Webhook body capture failed (rawBody missing) — refusing to process unsigned payload.",
    );
  }

  const signature = request.headers[HEADER_NAME];
  const signatureValue = Array.isArray(signature) ? signature[0] : signature;
  const ok = verifyMetaWebhookSignature(req.rawBody, signatureValue ?? null, secret);
  if (!ok) {
    throw new ForbiddenError("Webhook signature verification failed.");
  }
}
