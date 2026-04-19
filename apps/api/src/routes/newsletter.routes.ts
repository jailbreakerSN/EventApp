import type { FastifyPluginAsync } from "fastify";
import { validate } from "@/middlewares/validate.middleware";
import { authenticate } from "@/middlewares/auth.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import {
  newsletterService,
  NewsletterSubscribeSchema,
  NewsletterSendSchema,
} from "@/services/newsletter.service";

export const newsletterRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Subscribe to Newsletter (public, no auth) ─────────────────────────────
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

  // ─── Send Newsletter (super_admin only) ───────────────────────────────────
  fastify.post(
    "/send",
    {
      preHandler: [
        authenticate,
        requirePermission("platform:manage"),
        validate({ body: NewsletterSendSchema }),
      ],
      schema: {
        tags: ["Newsletter"],
        summary: "Send newsletter to all subscribers (super_admin only)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { subject, htmlBody, textBody } = request.body as {
        subject: string;
        htmlBody: string;
        textBody?: string;
      };
      const result = await newsletterService.sendNewsletter(subject, htmlBody, textBody);
      return reply.send({
        success: true,
        data: result,
      });
    },
  );
};
