import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { inviteService } from "@/services/invite.service";

const TokenParams = z.object({ token: z.string() });

export const inviteRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Accept Invite ──────────────────────────────────────────────────────
  fastify.post(
    "/:token/accept",
    {
      preHandler: [authenticate, validate({ params: TokenParams })],
      schema: { tags: ["Invites"], summary: "Accept organization invite", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { token } = request.params as z.infer<typeof TokenParams>;
      await inviteService.acceptInvite(token, request.user!);
      return reply.send({ success: true, data: null });
    },
  );

  // ─── Decline Invite ─────────────────────────────────────────────────────
  fastify.post(
    "/:token/decline",
    {
      preHandler: [authenticate, validate({ params: TokenParams })],
      schema: { tags: ["Invites"], summary: "Decline organization invite", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { token } = request.params as z.infer<typeof TokenParams>;
      await inviteService.declineInvite(token, request.user!);
      return reply.send({ success: true, data: null });
    },
  );
};
