import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "@/middlewares/auth.middleware";
import { announcementsService } from "@/services/announcements.service";

/**
 * T2.4 — Public (authenticated) read endpoint for platform
 * announcements. Business logic lives in `announcements.service.ts`
 * (architecture contract: routes are thin controllers).
 */
export const announcementsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/v1/announcements",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Announcements"],
        summary: "List active announcements for the caller's audience",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const data = await announcementsService.listActiveForUser(request.user!);
      return reply.send({ success: true, data });
    },
  );
};
