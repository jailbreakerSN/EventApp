import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "@/config";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { notificationService } from "@/services/notification.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { UpdateNotificationPreferenceSchema } from "@teranga/shared-types";
import { verifyUnsubscribeToken } from "@/services/notifications/unsubscribe-token";
import { unsubscribeCategory } from "@/services/notifications/unsubscribe.service";
import { renderLandingPage, backToParticipantCta } from "./_shared/landing-page";

const ParamsWithNotificationId = z.object({ notificationId: z.string() });

const NotificationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: z.coerce.boolean().optional(),
});

// Signed unsubscribe tokens are ~200 chars in the current scheme
// (base64(userId) + "." + category + "." + 64-char sig). Cap at 512 so
// callers can't amplify DoS by forcing HMAC over multi-MB query strings
// (Fastify's 1MB body limit does not apply to querystrings).
const UnsubscribeQuery = z.object({ token: z.string().min(1).max(512) });

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Get My Notifications ─────────────────────────────────────────────
  fastify.get(
    "/",
    {
      preHandler: [
        authenticate,
        requirePermission("notification:read_own"),
        validate({ query: NotificationQuery }),
      ],
      schema: {
        tags: ["Notifications"],
        summary: "Get my notifications",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { page, limit, unreadOnly } = request.query as z.infer<typeof NotificationQuery>;
      const result = await notificationService.getMyNotifications(request.user!, {
        page,
        limit,
        unreadOnly,
      });
      // Full PaginatedResponse shape — matches every other paginated
      // route in the API and unblocks the "page X of Y" UI that the
      // notifications dropdown needs when we wire up pagination. Was
      // previously returning only `{ total }`, forcing consumers to
      // cast the meta to a narrower type.
      return reply.send({
        success: true,
        data: result.data,
        meta: {
          page,
          limit,
          total: result.total,
          totalPages: limit > 0 ? Math.ceil(result.total / limit) : 1,
        },
      });
    },
  );

  // ─── Unread Count ─────────────────────────────────────────────────────
  fastify.get(
    "/unread-count",
    {
      preHandler: [authenticate, requirePermission("notification:read_own")],
      schema: {
        tags: ["Notifications"],
        summary: "Get unread notification count",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const snap = await db
        .collection(COLLECTIONS.NOTIFICATIONS)
        .where("userId", "==", request.user!.uid)
        .where("isRead", "==", false)
        .count()
        .get();
      return reply.send({ success: true, data: { count: snap.data().count } });
    },
  );

  // ─── Mark as Read ─────────────────────────────────────────────────────
  fastify.patch(
    "/:notificationId/read",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("notification:read_own"),
        validate({ params: ParamsWithNotificationId }),
      ],
      schema: {
        tags: ["Notifications"],
        summary: "Mark a notification as read",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { notificationId } = request.params as z.infer<typeof ParamsWithNotificationId>;
      await notificationService.markAsRead(notificationId, request.user!);
      return reply.send({ success: true });
    },
  );

  // ─── Mark All as Read ─────────────────────────────────────────────────
  fastify.patch(
    "/read-all",
    {
      preHandler: [authenticate, requirePermission("notification:read_own")],
      schema: {
        tags: ["Notifications"],
        summary: "Mark all notifications as read",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      await notificationService.markAllAsRead(request.user!);
      return reply.send({ success: true });
    },
  );

  // ─── Get Notification Preferences ─────────────────────────────────────
  fastify.get(
    "/preferences",
    {
      preHandler: [authenticate, requirePermission("notification:read_own")],
      schema: {
        tags: ["Notifications"],
        summary: "Get notification preferences",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const doc = await db
        .collection(COLLECTIONS.NOTIFICATION_PREFERENCES)
        .doc(request.user!.uid)
        .get();
      if (!doc.exists) {
        // Return defaults
        return reply.send({
          success: true,
          data: {
            id: request.user!.uid,
            userId: request.user!.uid,
            email: true,
            sms: true,
            push: true,
            quietHoursStart: null,
            quietHoursEnd: null,
            updatedAt: new Date().toISOString(),
          },
        });
      }
      return reply.send({ success: true, data: doc.data() });
    },
  );

  // ─── Update Notification Preferences ──────────────────────────────────
  fastify.put(
    "/preferences",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("notification:read_own"),
        validate({ body: UpdateNotificationPreferenceSchema }),
      ],
      schema: {
        tags: ["Notifications"],
        summary: "Update notification preferences",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const updates = request.body as z.infer<typeof UpdateNotificationPreferenceSchema>;
      const ref = db.collection(COLLECTIONS.NOTIFICATION_PREFERENCES).doc(request.user!.uid);
      const now = new Date().toISOString();

      await ref.set(
        {
          id: request.user!.uid,
          userId: request.user!.uid,
          ...updates,
          updatedAt: now,
        },
        { merge: true },
      );

      const doc = await ref.get();
      return reply.send({ success: true, data: doc.data() });
    },
  );

  // ─── List-Unsubscribe (subscriber-facing, Phase 3c.4) ─────────────────
  // Two surface forms, both resolve the same token and call the same
  // service action:
  //   GET  — User clicks the visible unsubscribe link → returns HTML.
  //   POST — Gmail's RFC 8058 one-click handler pings this → blank 200.
  //
  // Neither route is authenticated — the signed token IS the auth. Rate
  // limits kick in because both endpoints are unauthenticated and a
  // bot probing for valid tokens should be throttled quickly.

  fastify.get<{ Querystring: z.infer<typeof UnsubscribeQuery> }>(
    "/unsubscribe",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      preHandler: [validate({ query: UnsubscribeQuery })],
      schema: {
        tags: ["Notifications"],
        summary: "Unsubscribe from a non-mandatory email category (browser click)",
        querystring: {
          type: "object",
          required: ["token"],
          properties: { token: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const token = request.query.token;
      const verification = verifyUnsubscribeToken(token);
      if (!verification.ok) {
        return reply
          .status(400)
          .type("text/html; charset=utf-8")
          .send(
            renderLandingPage({
              kind: "error",
              headingText: "Désinscription impossible",
              message: "Ce lien de désinscription est invalide.",
              // Invalid tokens usually come from forwarded emails or
              // very old links — in both cases the user still wants
              // to manage their preferences, so offer a way in.
              ctas: [backToParticipantCta("Retour à l'accueil")],
            }),
          );
      }

      await unsubscribeCategory({
        userId: verification.userId,
        category: verification.category,
        source: "list_unsubscribe_click",
      });

      return reply
        .status(200)
        .type("text/html; charset=utf-8")
        .send(
          renderLandingPage({
            kind: "success",
            headingText: "Désinscription prise en compte",
            message: `Vous ne recevrez plus d'e-mails dans la catégorie « ${describeCategoryFr(
              verification.category,
            )} ». Vous pouvez réactiver cette préférence à tout moment depuis la page Paramètres.`,
            // Primary CTA points straight at the Settings page where the
            // user can re-enable the category if they changed their mind,
            // or tweak other notification preferences. Passes
            // ?hint=notifications so the settings page can highlight the
            // right section (no-op today, consumed once the hint is wired
            // up web-side).
            ctas: [
              {
                label: "Gérer mes préférences",
                href: `${config.PARTICIPANT_WEB_URL}/settings?hint=notifications`,
                variant: "primary",
              },
              {
                label: "Retour à l'accueil",
                href: config.PARTICIPANT_WEB_URL,
                variant: "secondary",
              },
            ],
          }),
        );
    },
  );

  fastify.post<{ Querystring: z.infer<typeof UnsubscribeQuery> }>(
    "/unsubscribe",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      preHandler: [validate({ query: UnsubscribeQuery })],
      schema: {
        tags: ["Notifications"],
        summary: "Unsubscribe via RFC 8058 List-Unsubscribe-Post one-click",
        querystring: {
          type: "object",
          required: ["token"],
          properties: { token: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      // RFC 8058: mailbox provider sends `List-Unsubscribe=One-Click` in
      // the body. Respond with a blank 200 or 202 regardless of success
      // — the spec forbids meaningful error responses from leaking to
      // the end user.
      const verification = verifyUnsubscribeToken(request.query.token);
      if (verification.ok) {
        await unsubscribeCategory({
          userId: verification.userId,
          category: verification.category,
          source: "list_unsubscribe_post",
        });
      }
      // Status 200 with empty body — what Gmail's one-click client
      // expects. Logging an invalid-token probe happens inside the
      // service/event layer; no response hint is given.
      return reply.status(200).send();
    },
  );
};

// ─── Unsubscribe category label (French-only for now) ───────────────────
// Kept inline rather than lifted into the email i18n dictionary because
// the landing page itself is French-only (users arrived from a French
// email; see landing-page.ts header for the full rationale). When the
// landing page grows real i18n, these labels move into the Dictionary.

function describeCategoryFr(category: "transactional" | "organizational" | "marketing"): string {
  switch (category) {
    case "transactional":
      return "E-mails transactionnels";
    case "organizational":
      return "E-mails organisationnels";
    case "marketing":
      return "E-mails marketing";
  }
}

// Page rendering itself moved into renderLandingPage (apps/api/src/
// routes/_shared/landing-page.ts). Locale story unchanged — users arrive
// here from emails sent in their own locale but the landing page is
// French-only for now; a future enhancement could echo the original
// locale via a token-embedded claim or an extra query param.
