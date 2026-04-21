import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { notificationService } from "@/services/notification.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { UpdateNotificationPreferenceSchema } from "@teranga/shared-types";
import { verifyUnsubscribeToken } from "@/services/notifications/unsubscribe-token";
import { unsubscribeCategory } from "@/services/notifications/unsubscribe.service";

const ParamsWithNotificationId = z.object({ notificationId: z.string() });

const NotificationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: z.coerce.boolean().optional(),
});

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

  fastify.get<{ Querystring: { token: string } }>(
    "/unsubscribe",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
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
      if (!token) {
        return reply
          .status(400)
          .type("text/html; charset=utf-8")
          .send(renderUnsubPage("error", "Lien de désinscription manquant."));
      }

      const verification = verifyUnsubscribeToken(token);
      if (!verification.ok) {
        return reply
          .status(400)
          .type("text/html; charset=utf-8")
          .send(renderUnsubPage("error", "Ce lien de désinscription est invalide."));
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
          renderUnsubPage(
            "success",
            `Vous ne recevrez plus d'e-mails dans la catégorie « ${describeCategoryFr(verification.category)} ». Vous pouvez réactiver cette préférence à tout moment depuis la page Paramètres.`,
          ),
        );
    },
  );

  fastify.post<{ Querystring: { token: string } }>(
    "/unsubscribe",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
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
      const token = request.query.token;
      const verification = token ? verifyUnsubscribeToken(token) : { ok: false as const };
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

// ─── Unsubscribe landing page ────────────────────────────────────────────
// Shared with the newsletter confirmation landing in structure; kept
// inline because it's a one-off HTTP response (not an email template).
// Zero interactive JS → safe under strict CSP if we ever enable one.
//
// No i18n yet — users arrive here by clicking a link in an email we sent
// in their own locale (the link is stamped per-send by email.service
// with the recipient's signed token, and the surrounding email body
// already rendered in fr / en / wo via pickDict). A future enhancement
// could echo the original locale via a token-embedded claim or an extra
// query param; until then, French copy is a safe default for the
// Senegal market. Mirrors the same tradeoff documented on
// renderResultPage in newsletter.routes.ts.

function renderUnsubPage(kind: "success" | "error", message: string): string {
  const safeMessage = escapeHtml(message);
  const headingEmoji = kind === "success" ? "✓" : "⚠";
  const headingText =
    kind === "success" ? "Désinscription prise en compte" : "Désinscription impossible";
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
