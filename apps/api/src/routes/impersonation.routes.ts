import type { FastifyPluginAsync } from "fastify";
import { ImpersonationExchangeRequestSchema } from "@teranga/shared-types";
import { validate } from "@/middlewares/validate.middleware";
import { impersonationCodeService } from "@/services/impersonation-code.service";

/**
 * Public (unauthenticated) exchange endpoint for the OAuth-style
 * impersonation auth-code flow.
 *
 * The target app's `/impersonation/accept` page calls this POST with
 * the code it received in its URL. The API validates + atomically
 * marks the code consumed, mints the Firebase custom token, and
 * returns it over HTTPS. The client immediately hands the token to
 * `signInWithCustomToken` and strips the code from its URL via
 * `history.replaceState`.
 *
 * Why unauthenticated:
 *   - The whole point of the exchange is that the caller has no
 *     existing Firebase session on this origin (the backoffice admin
 *     session is on a DIFFERENT origin). Requiring auth would be
 *     circular.
 *   - Security is carried by the code itself: opaque 256-bit random,
 *     single-use, ≤ 60 s TTL, bound to the caller's Origin.
 *
 * Hardening on top of the code's cryptographic properties:
 *   - Hard per-IP rate limit (30 req/min) to bound brute force.
 *     Combined with the 256-bit key space + 60 s window this makes
 *     brute-force exhaustion cryptographically impossible, but the
 *     rate limit keeps the attack surface small and produces a
 *     loud signal for the security dashboard if someone tries.
 *   - `Origin` header required and must equal the targetOrigin
 *     stored at issue time. A code leaked into a Referer, log line
 *     or clipboard cannot be consumed on a foreign origin.
 *   - The code row is read AND marked-consumed in a Firestore
 *     transaction so concurrent exchanges can't both succeed.
 */
export const impersonationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/exchange",
    {
      preHandler: [validate({ body: ImpersonationExchangeRequestSchema })],
      config: {
        // @fastify/rate-limit per-route override. 30/min/IP sits well
        // above legitimate use (one exchange per impersonation session)
        // while bounding a hostile caller hard. Key resolution falls
        // back to req.ip because this endpoint is unauthenticated —
        // there's no JWT to hash.
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["Admin"],
        summary: "Exchange an impersonation auth code for a Firebase custom token",
      },
    },
    async (request, reply) => {
      const { code } = request.body as { code: string };
      const data = await impersonationCodeService.exchange({
        code,
        origin: (request.headers.origin as string | undefined) ?? null,
        consumeIp: request.ip ?? null,
        consumeUa: (request.headers["user-agent"] as string | undefined) ?? null,
      });
      return reply.send({ success: true, data });
    },
  );
};
