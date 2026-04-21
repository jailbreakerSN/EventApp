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
import { ValidationError, NotFoundError } from "@/errors/app-error";

type SubscribeBody = z.infer<typeof NewsletterSubscribeSchema>;
type SendBody = z.infer<typeof NewsletterSendSchema>;
type ConfirmQuery = { token: string };

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
  fastify.get<{ Querystring: ConfirmQuery }>(
    "/confirm",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
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
      if (!token || typeof token !== "string") {
        return reply
          .status(400)
          .type("text/html; charset=utf-8")
          .send(renderResultPage("error", "Lien de confirmation manquant ou invalide."));
      }

      try {
        await newsletterService.confirm(token);
        return reply
          .status(200)
          .type("text/html; charset=utf-8")
          .send(
            renderResultPage(
              "success",
              "Votre inscription à la newsletter Teranga est confirmée. Merci !",
            ),
          );
      } catch (err) {
        const message =
          err instanceof ValidationError || err instanceof NotFoundError
            ? err.message
            : "Une erreur est survenue lors de la confirmation.";
        return reply
          .status(err instanceof ValidationError ? 400 : 500)
          .type("text/html; charset=utf-8")
          .send(renderResultPage("error", message));
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

// ─── Confirmation landing page ──────────────────────────────────────────────
// Minimal HTML served directly from the API. Kept inline (not a react-email
// template) because:
//   - It never sends via email — it's a browser-facing HTTP response.
//   - No i18n yet (French only; users arrived from a French email).
//   - Deliberately contains zero interactive JS so it's safe under strict
//     CSP if we ever enable one on the API surface.
function renderResultPage(kind: "success" | "error", message: string): string {
  const safeMessage = escapeHtml(message);
  const headingEmoji = kind === "success" ? "✓" : "⚠";
  const headingText = kind === "success" ? "Inscription confirmée" : "Confirmation échouée";
  const accentColor = kind === "success" ? "#16A34A" : "#DC2626";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Teranga Events — ${escapeHtml(headingText)}</title>
  <style>
    body { margin: 0; padding: 0; background: #F5F5F0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1A1A2E; }
    .wrap { max-width: 480px; margin: 0 auto; padding: 40px 24px; }
    .card { background: #fff; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden; }
    .header { background: #1A1A2E; color: #D4A843; padding: 24px; text-align: center; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
    .body { padding: 32px 24px; text-align: center; }
    .emoji { font-size: 40px; color: ${accentColor}; margin-bottom: 12px; line-height: 1; }
    .heading { font-size: 20px; font-weight: 600; margin: 0 0 12px 0; color: #1A1A2E; }
    .message { margin: 0; color: #4B5563; line-height: 1.5; }
    .footer { padding: 16px 24px 24px; color: #9CA3AF; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">Teranga</div>
      <div class="body">
        <div class="emoji" aria-hidden="true">${headingEmoji}</div>
        <h1 class="heading">${escapeHtml(headingText)}</h1>
        <p class="message">${safeMessage}</p>
      </div>
      <div class="footer">Teranga Events — La plateforme événementielle du Sénégal</div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
