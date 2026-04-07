import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { inviteService } from "@/services/invite.service";

const TokenBody = z.object({ token: z.string().min(1) });

export const inviteRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Accept Invite ──────────────────────────────────────────────────────
  fastify.post(
    "/accept",
    {
      preHandler: [authenticate, validate({ body: TokenBody })],
      schema: { tags: ["Invites"], summary: "Accept organization invite", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { token } = request.body as z.infer<typeof TokenBody>;
      await inviteService.acceptInvite(token, request.user!);
      return reply.send({ success: true, data: null });
    },
  );

  // ─── Decline Invite ─────────────────────────────────────────────────────
  fastify.post(
    "/decline",
    {
      preHandler: [authenticate, validate({ body: TokenBody })],
      schema: { tags: ["Invites"], summary: "Decline organization invite", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { token } = request.body as z.infer<typeof TokenBody>;
      await inviteService.declineInvite(token, request.user!);
      return reply.send({ success: true, data: null });
    },
  );
};
