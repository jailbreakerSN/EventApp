import type { FastifyPluginAsync } from "fastify";
import { validate } from "@/middlewares/validate.middleware";
import { newsletterService, NewsletterSubscribeSchema } from "@/services/newsletter.service";

export const newsletterRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Subscribe to Newsletter (public, no auth) ────────────────────────────
  fastify.post(
    "/subscribe",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      preHandler: [validate({ body: NewsletterSubscribeSchema })],
      schema: {
        tags: ["Newsletter"],
        summary: "Subscribe to the newsletter (public)",
      },
    },
    async (request, reply) => {
      const { email } = request.body as { email: string };
      await newsletterService.subscribe(email);
      return reply.send({
        success: true,
        message: "Inscription réussie",
      });
    },
  );
};
