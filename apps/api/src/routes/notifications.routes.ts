import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "@/config";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { notificationService } from "@/services/notification.service";
import { db, COLLECTIONS } from "@/config/firebase";
import {
  UpdateNotificationPreferenceSchema,
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATALOG_BY_KEY,
  type NotificationChannel,
  type NotificationDefinition,
  type NotificationPreferenceValue,
} from "@teranga/shared-types";
import { verifyUnsubscribeToken } from "@/services/notifications/unsubscribe-token";
import { unsubscribeCategory } from "@/services/notifications/unsubscribe.service";
import { renderLandingPage, backToParticipantCta } from "./_shared/landing-page";
import { notificationDispatchLogRepository } from "@/repositories/notification-dispatch-log.repository";
import { notificationSettingsRepository } from "@/repositories/notification-settings.repository";
import { isChannelAllowedForUser } from "@/services/notifications/channel-preferences";
import { notificationDispatcher } from "@/services/notification-dispatcher.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

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
        // Return defaults. `byKey` is always serialized (as `{}`) so the
        // preferences UI can diff against a stable shape without testing
        // for undefined — matches the Phase 2.6 per-channel contract.
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
            byKey: {},
            updatedAt: new Date().toISOString(),
          },
        });
      }
      // Shape already forward-compatible — `byKey` values are whatever
      // Firestore returned (bare boolean OR per-channel object). Clients
      // resolve each value via the same union shape the validator accepts.
      const data = doc.data() as Record<string, unknown> | undefined;
      return reply.send({
        success: true,
        data: { ...(data ?? {}), byKey: (data?.byKey as unknown) ?? {} },
      });
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

  // ─── Notification catalog (Phase 3 + Phase B.1 per-channel grid) ────
  // Returns the full NOTIFICATION_CATALOG plus the current user's byKey
  // overrides, shaped so the preferences page can render the list
  // without a second round-trip.
  //
  // Phase B.1 additions (per-channel UI): every entry now carries the
  // catalog's `supportedChannels` + `defaultChannels`, plus an
  // `effectiveChannels` map keyed by channel for the current user. The
  // effective map merges admin override (platform-level — per-org is
  // scoped elsewhere) → catalog defaults → user opt-out (resolved via
  // `isChannelAllowedForUser()` so the same helper the dispatcher uses
  // drives what the UI displays). Mandatory notifications (where
  // `userOptOutAllowed === false`) ignore the opt-out step — their
  // effective channels always match the catalog/admin source of truth.
  fastify.get(
    "/catalog",
    {
      preHandler: [authenticate, requirePermission("notification:read_own")],
      schema: {
        tags: ["Notifications"],
        summary: "List every notification + user's per-key/per-channel opt-out state",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const [prefDoc, platformOverrides] = await Promise.all([
        db.collection(COLLECTIONS.NOTIFICATION_PREFERENCES).doc(request.user!.uid).get(),
        notificationSettingsRepository.listAll(),
      ]);
      const byKey =
        (prefDoc.data()?.byKey as Record<string, NotificationPreferenceValue> | undefined) ?? {};
      const overrideByKey = new Map(platformOverrides.map((s) => [s.key, s]));

      const entries = NOTIFICATION_CATALOG.map((def: NotificationDefinition) => {
        const override = overrideByKey.get(def.key);

        // Effective channels before the user-opt-out step: admin override
        // if present and that override enables the notification, else
        // catalog defaults. Filter against supportedChannels defensively —
        // admins can't enable a channel the catalog doesn't advertise.
        const sourceChannels: NotificationChannel[] =
          override && override.enabled
            ? override.channels.filter((c) => def.supportedChannels.includes(c))
            : override && !override.enabled
              ? []
              : [...def.defaultChannels];

        // Per-channel legacy summary: bare-boolean `enabled` kept for the
        // pre-B.1 UI that renders a single switch per key. Derived from
        // the same resolution pipeline so the two never drift.
        // - If admin disabled the notification → false
        // - If the user opted out on every supported channel → false
        // - Otherwise true
        const someChannelLive = sourceChannels.some(
          (ch) => !def.userOptOutAllowed || isChannelAllowedForUser(prefDoc.data() ?? {}, def.key, ch),
        );
        const enabled = sourceChannels.length > 0 && someChannelLive;

        // `effectiveChannels`: for every channel the catalog supports,
        // return whether it will actually fire for this user right now.
        // Mandatory keys (`userOptOutAllowed=false`) ignore the user
        // step, matching dispatcher behaviour.
        const effectiveChannels = Object.fromEntries(
          def.supportedChannels.map((ch) => {
            const channelLiveAtAdminLayer = sourceChannels.includes(ch);
            if (!channelLiveAtAdminLayer) return [ch, false];
            if (!def.userOptOutAllowed) return [ch, true];
            return [ch, isChannelAllowedForUser(prefDoc.data() ?? {}, def.key, ch)];
          }),
        ) as Record<NotificationChannel, boolean>;

        return {
          key: def.key,
          category: def.category,
          displayName: def.displayName,
          description: def.description,
          supportedChannels: def.supportedChannels,
          defaultChannels: def.defaultChannels,
          userOptOutAllowed: def.userOptOutAllowed,
          enabled,
          effectiveChannels,
          // Pass the raw user override value for this key so the UI can
          // render the "edit" surface pre-populated without re-parsing
          // the preferences doc. `undefined` = no entry yet (user hasn't
          // touched this notification).
          userPreference: (byKey[def.key] ?? null) as NotificationPreferenceValue | null,
        };
      });

      return reply.send({ success: true, data: entries });
    },
  );

  // ─── History (Phase 2.5 — user communication history) ────────────────
  // Returns the dispatch-log rows addressed to the current user, most
  // recent first, capped at 90 days. DO NOT surface `recipientRef` /
  // `requestId` — those are operational trails, not user-facing.
  const HistoryQuery = z.object({
    limit: z.coerce.number().int().positive().max(100).default(50),
    cursor: z.string().optional(),
  });

  fastify.get(
    "/history",
    {
      preHandler: [
        authenticate,
        requirePermission("notification:read_own"),
        validate({ query: HistoryQuery }),
      ],
      schema: {
        tags: ["Notifications"],
        summary: "My notification delivery history (last 90 days)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { limit, cursor } = request.query as z.infer<typeof HistoryQuery>;
      const rows = await notificationDispatchLogRepository.listRecentForUser({
        userId: request.user!.uid,
        limit,
        cursorAttemptedAt: cursor,
      });

      // Resolve subject per-row at read time: admin override > catalog
      // displayName > raw key as last-resort fallback. Cache settings
      // lookups by key so a page with many rows doesn't issue one
      // Firestore read per row.
      const settingsByKey = new Map<string, string | null>();
      async function resolveSubject(key: string, locale: "fr" | "en" | "wo"): Promise<string> {
        if (!settingsByKey.has(key)) {
          const setting = await notificationSettingsRepository.findByKey(key);
          settingsByKey.set(
            key,
            setting?.subjectOverride ? setting.subjectOverride[locale] : null,
          );
        }
        const override = settingsByKey.get(key);
        if (override) return override;
        const def = NOTIFICATION_CATALOG_BY_KEY[key];
        return def?.displayName[locale] ?? key;
      }

      const locale: "fr" | "en" | "wo" = "fr";

      const data = await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          key: row.key,
          channel: row.channel,
          subject: await resolveSubject(row.key, locale),
          status: row.status,
          deliveryStatus: row.deliveryStatus ?? null,
          attemptedAt: row.attemptedAt,
          deliveredAt: row.deliveredAt ?? null,
          openedAt: row.openedAt ?? null,
          clickedAt: row.clickedAt ?? null,
          bouncedAt: row.bouncedAt ?? null,
          complainedAt: row.complainedAt ?? null,
          reason: row.reason ?? null,
          userOptOutAllowed:
            NOTIFICATION_CATALOG_BY_KEY[row.key]?.userOptOutAllowed ?? false,
        })),
      );

      const nextCursor = rows.length === limit ? rows[rows.length - 1]?.attemptedAt : null;

      return reply.send({
        success: true,
        data,
        meta: { limit, nextCursor },
      });
    },
  );

  // ─── Resubscribe (Phase 2.5) ─────────────────────────────────────────
  // Reverses a per-key opt-out. Users hit this when they see a suppressed
  // row in their history and decide they want the notification after all.
  // Only applies to catalog keys where `userOptOutAllowed === true`.
  const ResubscribeBody = z.object({ key: z.string().min(1) });

  fastify.post(
    "/resubscribe",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("notification:read_own"),
        validate({ body: ResubscribeBody }),
      ],
      schema: {
        tags: ["Notifications"],
        summary: "Reverse a per-key opt-out",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { key } = request.body as z.infer<typeof ResubscribeBody>;
      const def = NOTIFICATION_CATALOG_BY_KEY[key];
      if (!def) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Unknown notification key" },
        });
      }
      if (!def.userOptOutAllowed) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "NOT_OPTABLE",
            message: "This notification cannot be opted in/out of.",
          },
        });
      }

      const ref = db.collection(COLLECTIONS.NOTIFICATION_PREFERENCES).doc(request.user!.uid);
      const now = new Date().toISOString();
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? (snap.data() as Record<string, unknown>) : {};
        const byKey = {
          ...((existing.byKey as Record<string, NotificationPreferenceValue> | undefined) ?? {}),
          [key]: true,
        };
        tx.set(
          ref,
          {
            id: request.user!.uid,
            userId: request.user!.uid,
            byKey,
            updatedAt: now,
          },
          { merge: true },
        );
      });

      eventBus.emit("notification.resubscribed", {
        userId: request.user!.uid,
        key,
        actorId: request.user!.uid,
        requestId: getRequestId(),
        timestamp: now,
      });

      return reply.send({ success: true, data: { key, enabled: true } });
    },
  );

  // ─── Test-send to self (Phase B.1) ────────────────────────────────────
  // Users can trigger a send of any opt-outable notification to their own
  // inbox from the preferences UI. Guard rails:
  //   - Mandatory categories (userOptOutAllowed=false in the catalog) are
  //     REJECTED with 400. Rationale: even though the target inbox is the
  //     user's own, we don't want a "send me a fake password reset" lever
  //     in the UI — it's a footgun against phishing-awareness training
  //     and keeps the abuse surface small. Admins retain the ability via
  //     POST /v1/admin/notifications/:key/test-send.
  //   - Rate limit: 5 / hour / user, enforced in-memory. Acceptable for
  //     dev / staging; the production rollout will swap in a Firestore-
  //     backed counter keyed by (userId, hourBucket) so clusters share
  //     the budget. Tracked as a TODO on the ticket.
  //   - Dispatch runs with testMode=true so the send bypasses admin-
  //     disabled + user-opt-out + dedup (same semantics as the admin
  //     preview path, just self-targeted).
  const TestSendBody = z.object({ key: z.string().min(1) });

  // In-memory rate-limit bucket. Key = userId, value = rolling list of
  // ISO timestamps of the last attempts. Window + max kept next to the
  // route for easy audit: 5 attempts per hour per user.
  const TEST_SEND_WINDOW_MS = 60 * 60 * 1000; // 1h
  const TEST_SEND_MAX = 5;
  const testSendBucket = new Map<string, number[]>();

  function allowTestSend(userId: string, now: number): boolean {
    const windowStart = now - TEST_SEND_WINDOW_MS;
    const existing = testSendBucket.get(userId) ?? [];
    const trimmed = existing.filter((t) => t > windowStart);
    if (trimmed.length >= TEST_SEND_MAX) {
      testSendBucket.set(userId, trimmed);
      return false;
    }
    trimmed.push(now);
    testSendBucket.set(userId, trimmed);
    return true;
  }

  fastify.post(
    "/test-send",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("notification:read_own"),
        validate({ body: TestSendBody }),
      ],
      schema: {
        tags: ["Notifications"],
        summary: "Send a notification preview to the caller's own inbox",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { key } = request.body as z.infer<typeof TestSendBody>;
      const definition = NOTIFICATION_CATALOG_BY_KEY[key];
      if (!definition) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: `Unknown notification key: ${key}` },
        });
      }
      if (!definition.userOptOutAllowed) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "NOT_OPTABLE",
            message:
              "This notification is mandatory and cannot be self-triggered as a test. Ask an admin to preview it from the notifications control plane.",
          },
        });
      }

      const userId = request.user!.uid;
      if (!allowTestSend(userId, Date.now())) {
        return reply.status(429).send({
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many test sends. Please wait and try again later.",
          },
        });
      }

      // Look up the caller's locale from the user doc so the preview
      // renders in the language they actually read. Defaults to "fr"
      // (platform primary language) if the doc is missing or mute.
      let locale: "fr" | "en" | "wo" = "fr";
      const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (userSnap.exists) {
        const pref = userSnap.data()?.preferredLanguage;
        if (pref === "fr" || pref === "en" || pref === "wo") locale = pref;
      }
      const email = request.user!.email ?? undefined;

      const requestId = getRequestId();
      const now = new Date().toISOString();

      // Fire-and-forget dispatch — matches the admin test-send contract.
      // testMode=true bypasses admin-disabled / user-opt-out / dedup so
      // the user always gets the preview even if they've opted out.
      await notificationDispatcher.dispatch(
        {
          key,
          recipients: [
            email
              ? { userId, email, preferredLocale: locale }
              : { userId, preferredLocale: locale },
          ],
          params: {},
          testMode: true,
        },
        { actorId: userId, requestId },
      );

      // Distinct audit trail — admin test-sends emit `notification.test_sent`,
      // self-sends emit this one so the admin view can filter per actor.
      eventBus.emit("notification.test_sent_self", {
        key,
        userId,
        locale,
        actorId: userId,
        requestId,
        timestamp: now,
      });

      return reply.status(202).send({
        success: true,
        data: { dispatched: true, key, locale },
      });
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
