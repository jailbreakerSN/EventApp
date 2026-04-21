import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { validate } from "@/middlewares/validate.middleware";
import { authenticate } from "@/middlewares/auth.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import {
  newsletterService,
  NewsletterSubscribeSchema,
  NewsletterSendSchema,
} from "@/services/newsletter.service";
import { ValidationError, NotFoundError } from "@/errors/app-error";
import { renderLandingPage, backToParticipantCta } from "./_shared/landing-page";

type SubscribeBody = z.infer<typeof NewsletterSubscribeSchema>;
type SendBody = z.infer<typeof NewsletterSendSchema>;

// Signed HMAC tokens are ~180 chars in the current scheme (base64(userId)
// or subscriberId + "." + ttl + "." + 64-char sig). Cap at 512 to absorb
// future format changes while blocking arbitrarily long payloads. Without
// this cap, unauthenticated callers could ship multi-MB query strings
// (Fastify's 1MB body limit does not apply to querystrings) and force
// the server to run HMAC over the full length before rejecting — a cheap
// DoS amplification vector.
const TokenQuery = z.object({ token: z.string().min(1).max(512) });

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
        summary: "Subscribe to the newsletter (public) — starts double opt-in",
      },
    },
    async (request, reply) => {
      // IP + User-Agent are captured for the GDPR/CASL consent record.
      // We deliberately use `request.ip` (Fastify's trust-proxy-aware
      // getter) rather than raw socket address so a forwarded IP works
      // correctly behind Cloud Run's load balancer. User-Agent is
      // opportunistic — missing header is fine.
      await newsletterService.subscribe(request.body.email, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });
      // Message is deliberately vague about whether the email was new,
      // already pending, or already confirmed — prevents subscriber-list
      // enumeration via the subscribe endpoint. Hardcoded French because
      // the newsletter signup widget (NewsletterSignup) owns its own
      // localized success copy; consumers SHOULD display their own text
      // and ignore this message. Kept in the payload as a fallback for
      // any direct-API caller that bypasses the widget.
      return reply.send({
        success: true,
        message: "Vérifiez votre boîte mail pour confirmer votre inscription.",
      });
    },
  );

  // ─── Confirm Newsletter Subscription (public, token-authenticated) ────────
  // Returns HTML because the user arrives here by clicking a link in an
  // email — so we need a landing page, not a JSON payload. Tight rate
  // limit because each token is effectively single-use and anyone spamming
  // this endpoint is probing for valid tokens.
  fastify.get<{ Querystring: z.infer<typeof TokenQuery> }>(
    "/confirm",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      preHandler: [validate({ query: TokenQuery })],
      schema: {
        tags: ["Newsletter"],
        summary: "Confirm a newsletter subscription via signed token",
        querystring: {
          type: "object",
          required: ["token"],
          properties: { token: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const token = request.query.token;

      try {
        await newsletterService.confirm(token);
        return reply
          .status(200)
          .type("text/html; charset=utf-8")
          .send(
            renderLandingPage({
              kind: "success",
              headingText: "Inscription confirmée",
              message: "Votre inscription à la newsletter Teranga est confirmée. Merci !",
              // Primary CTA brings the user into the product — the whole
              // point of confirming the newsletter is to engage with
              // Teranga, so a dead-end confirmation page wastes the
              // moment of maximum intent.
              ctas: [backToParticipantCta("Découvrir les événements")],
            }),
          );
      } catch (err) {
        const message =
          err instanceof ValidationError || err instanceof NotFoundError
            ? err.message
            : "Une erreur est survenue lors de la confirmation.";
        return reply
          .status(err instanceof ValidationError ? 400 : 500)
          .type("text/html; charset=utf-8")
          .send(
            renderLandingPage({
              kind: "error",
              headingText: "Confirmation échouée",
              message,
              // Offer the product even on failure — a user who arrived
              // via an expired link still wants to browse events, and a
              // bare error page with no way forward is a churn cliff.
              ctas: [backToParticipantCta("Retour à l'accueil")],
            }),
          );
      }
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
