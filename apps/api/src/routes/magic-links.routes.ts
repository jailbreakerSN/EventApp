/**
 * Organizer overhaul — Phase O10.
 *
 * Magic-link surface:
 *   - `POST /v1/magic-links` — organizer issues a link.
 *   - `GET  /v1/magic-links/verify?token=…` — UNAUTHENTICATED, the
 *     URL itself is the credential. Used by the speaker/sponsor
 *     portal landing page.
 *   - `POST /v1/magic-links/:tokenHash/revoke` — organizer revokes.
 *
 * The verify route deliberately does NOT carry an `authenticate`
 * preHandler — the token IS the credential. We pin a tight rate
 * limit on it (handled at the global level via the rate-limit
 * middleware's `ip:*` bucket) so brute-force guessing is uneconomic.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { magicLinkService } from "@/services/magic-link.service";
import { IssueMagicLinkSchema } from "@teranga/shared-types";

const TokenQuery = z.object({
  // Tight bound — a v1 token is ≤ 200 chars in normal use; we accept
  // up to 400 to absorb future format growth without becoming a DoS
  // surface (the verifier returns 400 fast on malformed input).
  token: z.string().min(20).max(400),
});

const TokenHashParam = z.object({
  tokenHash: z
    .string()
    .min(1)
    .max(128)
    // SHA-256 hex digest characters only — no chance of injection
    // into the Firestore doc path.
    .regex(/^[a-f0-9]+$/i),
});

export const magicLinksRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Issue ────────────────────────────────────────────────────────
  // W10-P2 / S3 — magic-link issuance is an email/SMS amplification
  // primitive (the API may dispatch a Resend send + a WhatsApp
  // template per call). Cap at 5 issues per minute per caller —
  // tighter than the global `user:*` 120/min budget. Bulk speaker
  // onboarding for a 50-speaker conference still completes in 10
  // minutes; an attacker who steals an organiser session can't burn
  // through Resend credits at scale.
  fastify.post(
    "/",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ body: IssueMagicLinkSchema }),
      ],
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: {
        tags: ["MagicLinks"],
        summary: "Issue a magic link for a speaker / sponsor portal",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const dto = request.body as Parameters<typeof magicLinkService.issue>[0];
      const result = await magicLinkService.issue(dto, request.user!);
      // We surface the plaintext token ONCE in the response (so the
      // operator UI can copy it / send the email). The audit log
      // never persists it.
      return reply.status(201).send({
        success: true,
        data: { token: result.token, record: result.record },
      });
    },
  );

  // ─── Verify (unauthenticated — the URL is the credential) ────────
  // W10-P2 / S3 — unauthenticated endpoint, brute-force-attractive.
  // The token namespace is 64 hex chars (≈10^77) so brute force is
  // already economically infeasible, but we cap each IP at 30 verifies
  // per minute to bound the cost of a noisy scan. Legitimate use
  // (speaker re-opens portal page, page reloads on flaky network)
  // stays well under the cap.
  fastify.get(
    "/verify",
    {
      preHandler: [validate({ query: TokenQuery })],
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
      schema: {
        tags: ["MagicLinks"],
        summary: "Verify a magic-link token (no auth — the URL is the credential)",
      },
    },
    async (request, reply) => {
      const { token } = request.query as z.infer<typeof TokenQuery>;
      const data = await magicLinkService.verify(token);
      return reply.send({ success: true, data });
    },
  );

  // ─── Revoke ───────────────────────────────────────────────────────
  fastify.post(
    "/:tokenHash/revoke",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: TokenHashParam }),
      ],
      schema: {
        tags: ["MagicLinks"],
        summary: "Revoke a previously-issued magic link",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { tokenHash } = request.params as z.infer<typeof TokenHashParam>;
      const data = await magicLinkService.revoke(tokenHash, request.user!);
      return reply.send({ success: true, data });
    },
  );
};
