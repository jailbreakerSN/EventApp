import type { FastifyPluginAsync } from "fastify";
import type { z } from "zod";
import { validate } from "@/middlewares/validate.middleware";
import { authenticate } from "@/middlewares/auth.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import {
  newsletterService,
  NewsletterSubscribeSchema,
  NewsletterSendSchema,
} from "@/services/newsletter.service";

// Body types are derived from the Zod schemas so the route handlers receive
// `request.body` already typed — no unsafe `as { ... }` casts that bypass
// the Zod transforms (e.g. the lowercase/trim on email).
type SubscribeBody = z.infer<typeof NewsletterSubscribeSchema>;
type SendBody = z.infer<typeof NewsletterSendSchema>;

export const newsletterRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Subscribe to Newsletter (public, no auth) ─────────────────────────────
  fastify.post<{ Body: SubscribeBody }>(
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
      await newsletterService.subscribe(request.body.email);
      return reply.send({
        success: true,
        message: "Inscription réussie",
      });
    },
  );

  // ─── Send Newsletter (super_admin only) ───────────────────────────────────
  fastify.post<{ Body: SendBody }>(
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
      // `authenticate` populates request.user (module-augmented on
      // FastifyRequest); non-null assertion is safe because the middleware
      // short-circuits with 401 on missing auth before this handler runs.
      const actorUserId = request.user!.uid;
      const result = await newsletterService.sendNewsletter({
        subject: request.body.subject,
        htmlBody: request.body.htmlBody,
        textBody: request.body.textBody,
        actorUserId,
      });
      return reply.send({
        success: true,
        data: result,
      });
    },
  );
};
