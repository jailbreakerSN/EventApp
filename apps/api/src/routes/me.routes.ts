import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { RegisterFcmTokenRequestSchema } from "@teranga/shared-types";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { fcmTokensService } from "@/services/fcm-tokens.service";

// ─── Me Routes (Phase C.1 — Web Push + self-service) ────────────────────────
// Endpoints scoped to the authenticated caller (`request.user`). FCM token
// registration goes here so browsers can pair a push destination with the
// signed-in account without touching the user doc directly — Firestore
// rules forbid client writes to `fcmTokens`.

const TokenFingerprintParams = z.object({
  // sha256(token).slice(0,16) — 16 hex chars. Reject anything off-shape so
  // a stray "me/fcm-tokens/undefined" from the UI can't hit the service.
  tokenFingerprint: z
    .string()
    .length(16)
    .regex(/^[a-f0-9]{16}$/i, "Invalid token fingerprint"),
});

export const meRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Register / Refresh FCM Token ─────────────────────────────────────
  // Browser permission prompts can flake and re-fire — the service dedupes
  // and bumps `lastSeenAt` when the same token re-registers. The 20/h cap
  // stops a permission-loop bug from DoS-ing the write path.
  fastify.post(
    "/fcm-tokens",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 hour",
        },
      },
      preHandler: [authenticate, validate({ body: RegisterFcmTokenRequestSchema })],
      schema: {
        tags: ["Me"],
        summary: "Register (or refresh) an FCM push token for the current user",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof RegisterFcmTokenRequestSchema>;
      const result = await fcmTokensService.register(request.user!, body);
      return reply.status(201).send({
        success: true,
        data: {
          tokenFingerprint: result.tokenFingerprint,
          status: result.status,
          tokenCount: result.tokenCount,
        },
      });
    },
  );

  // ─── Revoke a Single FCM Token ────────────────────────────────────────
  fastify.delete(
    "/fcm-tokens/:tokenFingerprint",
    {
      preHandler: [authenticate, validate({ params: TokenFingerprintParams })],
      schema: {
        tags: ["Me"],
        summary: "Revoke a specific FCM push token by fingerprint",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { tokenFingerprint } = request.params as z.infer<typeof TokenFingerprintParams>;
      await fcmTokensService.revoke(request.user!, tokenFingerprint);
      return reply.status(204).send();
    },
  );

  // ─── Revoke All FCM Tokens (sign-out) ─────────────────────────────────
  fastify.delete(
    "/fcm-tokens",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Me"],
        summary: "Revoke every FCM push token on the current user (sign-out)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      await fcmTokensService.revokeAllForUser(request.user!);
      return reply.status(204).send();
    },
  );
};
