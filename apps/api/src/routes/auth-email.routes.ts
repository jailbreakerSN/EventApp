import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { authEmailService } from "@/services/auth-email.service";
import { type AuthActionAudience } from "@/config/public-urls";

// ─── Auth email routes ──────────────────────────────────────────────────
//
// Two endpoints:
//   POST /v1/auth/send-verification-email  (auth'd — caller is the user)
//   POST /v1/auth/send-password-reset-email (public — forgot-password flow)
//
// Both route through admin.auth().generate*Link() and ship a branded
// Resend template instead of letting Firebase's default mailer handle
// it. See services/auth-email.service.ts for the rationale.

const SendVerificationBody = z.object({
  /**
   * Which web app hosted the signup. Determines the landing page host
   * for the OOB link: participant | backoffice. Sent by the client so
   * a single API serves both surfaces.
   */
  audience: z.enum(["participant", "backoffice"]).default("participant"),
});

const SendPasswordResetBody = z.object({
  email: z
    .string()
    .email("Adresse e-mail invalide")
    .max(255)
    .transform((v) => v.trim().toLowerCase()),
  audience: z.enum(["participant", "backoffice"]).default("participant"),
});

export const authEmailRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Send verification email (authenticated caller) ─────────────────
  //
  // Caller must be signed in; we send the verification mail to THEIR
  // email (the one stored in Firebase Auth). Rate-limited because a
  // bot loop on "resend verification" could pummel Resend + the user.
  fastify.post<{ Body: z.infer<typeof SendVerificationBody> }>(
    "/send-verification-email",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      preHandler: [authenticate, validate({ body: SendVerificationBody })],
      schema: {
        tags: ["Auth"],
        summary: "Send a branded email-verification link to the caller's own address",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body as { audience: AuthActionAudience };
      await authEmailService.sendVerificationEmail({
        userId: user.uid,
        audience: body.audience,
        // AuthUser doesn't carry preferredLanguage yet — the service
        // looks the user up via Admin SDK and falls back to French when
        // unset. When the user doc's locale lands on the token claim,
        // wire it through here.
        locale: null,
      });
      // Message is deliberately terse — the UI owns the toast copy.
      return reply.send({ success: true });
    },
  );

  // ─── Send password-reset email (public, forgot-password flow) ───────
  //
  // Deliberately anti-enumeration:
  //   - Always returns the same generic message whether the email is
  //     on file or not.
  //   - Aggressive rate limit on the route: 3 requests / 5 min per IP.
  //     Above that returns 429 — keeps password-reset abuse off the
  //     deliverability dashboard. The service-layer probe is still
  //     cheap (one Admin SDK call) even when rate-limited above.
  //   - Email presence is never surfaced in the response body, only
  //     counted in server logs.
  fastify.post<{ Body: z.infer<typeof SendPasswordResetBody> }>(
    "/send-password-reset-email",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "5 minutes",
        },
      },
      preHandler: [validate({ body: SendPasswordResetBody })],
      schema: {
        tags: ["Auth"],
        summary: "Send a branded password-reset link (public, anti-enumeration)",
      },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof SendPasswordResetBody>;
      await authEmailService.sendPasswordResetEmail({
        email: body.email,
        audience: body.audience,
        // No user lookup up here — we don't know the locale yet. Let
        // the service default to fr, same as the newsletter flow.
        locale: null,
      });
      return reply.send({
        success: true,
        // Generic copy — do not branch on whether we actually sent
        // anything, or we leak account existence.
        message:
          "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.",
      });
    },
  );
};
