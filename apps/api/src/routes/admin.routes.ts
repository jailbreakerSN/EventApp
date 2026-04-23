import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { adminService } from "@/services/admin.service";
import { subscriptionService } from "@/services/subscription.service";
import {
  AdminUserQuerySchema,
  AdminOrgQuerySchema,
  AdminEventQuerySchema,
  AdminAuditQuerySchema,
  UpdateUserRolesSchema,
  UpdateUserStatusSchema,
  AssignPlanSchema,
  NOTIFICATION_CATALOG,
  NotificationSettingSchema,
  NotificationLocaleSchema,
  NotificationChannelSchema,
  type NotificationDefinition,
  type NotificationSetting,
} from "@teranga/shared-types";
import {
  notificationSettingsRepository,
  notificationSettingDocId,
} from "@/repositories/notification-settings.repository";
import { notificationDispatchLogRepository } from "@/repositories/notification-dispatch-log.repository";
import { rateLimit } from "@/services/rate-limit.service";
import {
  notificationSettingsHistoryRepository,
  computeSettingDiff,
} from "@/repositories/notification-settings-history.repository";
import { notificationPreviewService } from "@/services/notifications/preview.service";
import { notificationDispatcher } from "@/services/notification-dispatcher.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

const ParamsUserId = z.object({ userId: z.string() });
const ParamsOrgId = z.object({ orgId: z.string() });

// ─── Admin Routes ───────────────────────────────────────────────────────────
// All endpoints require platform:manage permission (super_admin only).

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const adminPreHandler = [authenticate, requirePermission("platform:manage")];

  // ── Platform Stats ──────────────────────────────────────────────────────

  fastify.get(
    "/stats",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["Admin"],
        summary: "Get platform-wide statistics",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const stats = await adminService.getStats(request.user!);
      return reply.send({ success: true, data: stats });
    },
  );

  // ── Inbox signals (Phase 2 — task-oriented admin landing) ──────────────
  // Returns the list of "things that need admin attention" — pending
  // moderation items, past-due billing, stale payments, expired invites.
  // Every signal carries (id, category, severity, title, description,
  // count, href) so the UI can render a card + CTA with no extra business
  // logic. Queries run in parallel server-side; per-section failures
  // degrade to count=0 rather than failing the whole response.
  fastify.get(
    "/inbox",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["Admin"],
        summary: "Aggregated admin inbox signals (moderation, billing, ops…)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const data = await adminService.getInboxSignals(request.user!);
      return reply.send({ success: true, data });
    },
  );

  // ── Cross-object search (Phase 1 — powers the ⌘K command palette) ──────
  // Returns up to 5 hits per object type. Search is substring on the
  // human-readable fields callers are most likely to type:
  //   - users: displayName + email
  //   - organizations: name + slug
  //   - events: title + slug
  //   - venues: name + slug + city
  //
  // Performance model: each call issues 4 parallel small Firestore reads
  // (limit 5 per collection) + client-side substring filter. We deliberately
  // keep it simple and skip Algolia/ElasticSearch — admin search doesn't
  // justify a third-party dependency today.
  fastify.get(
    "/search",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["Admin"],
        summary: "Cross-object search for the admin command palette",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const q = String((request.query as { q?: unknown })?.q ?? "").trim();
      if (q.length < 2) {
        return reply.send({
          success: true,
          data: { users: [], organizations: [], events: [], venues: [] },
        });
      }
      const data = await adminService.globalSearch(request.user!, q);
      return reply.send({ success: true, data });
    },
  );

  // ── Users ───────────────────────────────────────────────────────────────

  fastify.get(
    "/users",
    {
      preHandler: [...adminPreHandler, validate({ query: AdminUserQuerySchema })],
      schema: {
        tags: ["Admin"],
        summary: "List all platform users",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const result = await adminService.listUsers(
        request.user!,
        request.query as z.infer<typeof AdminUserQuerySchema>,
      );
      return reply.send({ success: true, ...result });
    },
  );

  // Phase 4 — Super-admin impersonation.
  // Returns a Firebase custom token + metadata. The client exchanges
  // the token via signInWithCustomToken() on a fresh auth session,
  // signing-out the caller first to avoid cross-session leaks. The
  // admin-grade SaaS "Log in as user" pattern. Every call is audit-
  // logged (user.impersonated) with the original actor uid stamped
  // on the minted token's custom claims (`impersonatedBy`).
  fastify.post(
    "/users/:userId/impersonate",
    {
      preHandler: [...adminPreHandler, validate({ params: ParamsUserId })],
      schema: {
        tags: ["Admin"],
        summary: "Mint a custom Firebase token to log in as the target user",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { userId } = request.params as z.infer<typeof ParamsUserId>;
      const data = await adminService.startImpersonation(request.user!, userId);
      return reply.send({ success: true, data });
    },
  );

  // Phase 3 — fetch a single admin user row (Phase 1 already exposes
  // list; the detail page needs a targeted getter to avoid iterating).
  fastify.get(
    "/users/:userId",
    {
      preHandler: [...adminPreHandler, validate({ params: ParamsUserId })],
      schema: {
        tags: ["Admin"],
        summary: "Get a single admin user row (with JWT drift check)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { userId } = request.params as z.infer<typeof ParamsUserId>;
      const data = await adminService.getUserById(request.user!, userId);
      return reply.send({ success: true, data });
    },
  );

  fastify.patch(
    "/users/:userId/roles",
    {
      preHandler: [
        ...adminPreHandler,
        validate({ params: ParamsUserId, body: UpdateUserRolesSchema }),
      ],
      schema: {
        tags: ["Admin"],
        summary: "Update a user's roles",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { userId } = request.params as z.infer<typeof ParamsUserId>;
      const { roles } = request.body as z.infer<typeof UpdateUserRolesSchema>;
      await adminService.updateUserRoles(request.user!, userId, roles);
      return reply.status(204).send();
    },
  );

  fastify.patch(
    "/users/:userId/status",
    {
      preHandler: [
        ...adminPreHandler,
        validate({ params: ParamsUserId, body: UpdateUserStatusSchema }),
      ],
      schema: {
        tags: ["Admin"],
        summary: "Suspend or activate a user",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { userId } = request.params as z.infer<typeof ParamsUserId>;
      const { isActive } = request.body as z.infer<typeof UpdateUserStatusSchema>;
      await adminService.updateUserStatus(request.user!, userId, isActive);
      return reply.status(204).send();
    },
  );

  // ── Organizations ───────────────────────────────────────────────────────

  fastify.get(
    "/organizations",
    {
      preHandler: [...adminPreHandler, validate({ query: AdminOrgQuerySchema })],
      schema: {
        tags: ["Admin"],
        summary: "List all organizations",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const result = await adminService.listOrganizations(
        request.user!,
        request.query as z.infer<typeof AdminOrgQuerySchema>,
      );
      return reply.send({ success: true, ...result });
    },
  );

  fastify.patch(
    "/organizations/:orgId/verify",
    {
      preHandler: [...adminPreHandler, validate({ params: ParamsOrgId })],
      schema: {
        tags: ["Admin"],
        summary: "Verify an organization",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsOrgId>;
      await adminService.verifyOrganization(request.user!, orgId);
      return reply.status(204).send();
    },
  );

  fastify.patch(
    "/organizations/:orgId/status",
    {
      preHandler: [
        ...adminPreHandler,
        validate({ params: ParamsOrgId, body: UpdateUserStatusSchema }),
      ],
      schema: {
        tags: ["Admin"],
        summary: "Suspend or activate an organization",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsOrgId>;
      const { isActive } = request.body as z.infer<typeof UpdateUserStatusSchema>;
      await adminService.updateOrgStatus(request.user!, orgId, isActive);
      return reply.status(204).send();
    },
  );

  // ── Events ──────────────────────────────────────────────────────────────

  fastify.get(
    "/events",
    {
      preHandler: [...adminPreHandler, validate({ query: AdminEventQuerySchema })],
      schema: {
        tags: ["Admin"],
        summary: "List all events (cross-organization)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const result = await adminService.listEvents(
        request.user!,
        request.query as z.infer<typeof AdminEventQuerySchema>,
      );
      return reply.send({ success: true, ...result });
    },
  );

  // ── Audit Logs ──────────────────────────────────────────────────────────

  fastify.get(
    "/audit-logs",
    {
      preHandler: [...adminPreHandler, validate({ query: AdminAuditQuerySchema })],
      schema: {
        tags: ["Admin"],
        summary: "Query audit logs",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const result = await adminService.listAuditLogs(
        request.user!,
        request.query as z.infer<typeof AdminAuditQuerySchema>,
      );
      return reply.send({ success: true, ...result });
    },
  );

  // ── Subscription override (Phase 5) ─────────────────────────────────────
  // Assigns a catalog plan + optional overrides to a specific organization.
  // Requires platform:manage (already on adminPreHandler) + subscription:override
  // (enforced inside the service). Cross-tenant by design — this is the
  // endpoint the "custom plan for a specific org" UI drawer calls.

  fastify.post(
    "/organizations/:orgId/subscription/assign",
    {
      preHandler: [...adminPreHandler, validate({ params: ParamsOrgId, body: AssignPlanSchema })],
      schema: {
        tags: ["Admin", "Subscriptions"],
        summary: "Assign a catalog plan (with optional overrides) to an organization",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsOrgId>;
      const subscription = await subscriptionService.assignPlan(
        orgId,
        request.body as z.infer<typeof AssignPlanSchema>,
        request.user!,
      );
      return reply.send({ success: true, data: subscription });
    },
  );

  // ─── Notification Control Plane (Phase 4) ─────────────────────────────
  // Super-admin-only endpoints for enabling/disabling notifications,
  // overriding default channels, and customising subject lines without
  // a code deploy. Every write emits notification.setting_updated for
  // audit; the server-only Firestore rules on notificationSettings mean
  // these are the ONLY path to toggle a notification.
  //
  // Read path: GET /notifications → catalog ⋈ stored overrides (merged)
  // Write path: PUT /notifications/:key → upsert the setting

  fastify.get(
    "/notifications",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["Admin", "Notifications"],
        summary: "List every notification with admin override state",
        security: [{ BearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      // Pull every override; small collection (~26 entries in Phase 2),
      // no pagination. Merge with the catalog so the UI sees one row per
      // notification with its effective state.
      const overrides = await notificationSettingsRepository.listAll();
      const overridesByKey = new Map(overrides.map((s) => [s.key, s]));

      const entries = NOTIFICATION_CATALOG.map((def: NotificationDefinition) => {
        const override = overridesByKey.get(def.key);
        return {
          key: def.key,
          category: def.category,
          displayName: def.displayName,
          description: def.description,
          supportedChannels: def.supportedChannels,
          userOptOutAllowed: def.userOptOutAllowed,
          // Effective state — override wins when present.
          enabled: override?.enabled ?? true,
          channels: override?.channels ?? def.defaultChannels,
          subjectOverride: override?.subjectOverride,
          hasOverride: override !== undefined,
          updatedAt: override?.updatedAt,
          updatedBy: override?.updatedBy,
        };
      });

      return reply.send({ success: true, data: entries });
    },
  );

  // Body schema: just the mutable fields of NotificationSetting (key +
  // updatedAt + updatedBy are derived server-side).
  // Phase 2.4 — optional `reason` field lands in the history doc alongside
  // the diff so future auditors can answer "why did this change".
  const UpdateNotificationSettingBody = NotificationSettingSchema.pick({
    enabled: true,
    channels: true,
    subjectOverride: true,
  }).extend({
    reason: z.string().max(500).optional(),
  });
  const ParamsNotificationKey = z.object({ key: z.string().min(1) });

  fastify.put<{
    Params: z.infer<typeof ParamsNotificationKey>;
    Body: z.infer<typeof UpdateNotificationSettingBody>;
  }>(
    "/notifications/:key",
    {
      preHandler: [
        ...adminPreHandler,
        validate({ params: ParamsNotificationKey, body: UpdateNotificationSettingBody }),
      ],
      schema: {
        tags: ["Admin", "Notifications"],
        summary: "Upsert the super-admin override for a notification key",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      const body = request.body;

      // Catalog check — reject unknown keys so a typo can't create
      // orphan Firestore docs that the dispatcher would never read.
      const definition = NOTIFICATION_CATALOG.find((d) => d.key === key);
      if (!definition) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: `Unknown notification key: ${key}` },
        });
      }

      // Enforce channel subset-of-supported (belt-and-suspenders; the
      // dispatcher already filters). Rejecting here gives a clearer
      // error than silent filtering.
      const invalid = body.channels.filter((c) => !definition.supportedChannels.includes(c));
      if (invalid.length > 0) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_CHANNEL",
            message: `Channels ${invalid.join(", ")} not supported for ${key}. Supported: ${definition.supportedChannels.join(", ")}.`,
          },
        });
      }

      const now = new Date().toISOString();
      const setting: NotificationSetting = {
        key,
        organizationId: null,
        enabled: body.enabled,
        channels: body.channels,
        ...(body.subjectOverride ? { subjectOverride: body.subjectOverride } : {}),
        updatedAt: now,
        updatedBy: request.user!.uid,
      };

      // Phase 2.4 — transactional upsert + history append so the audit
      // trail never drifts from the live setting.
      //
      // Phase D.M-3 fix — the `previous` read MUST happen inside the
      // transaction, not before it. Before this change two concurrent
      // PUTs from two admins to the same key would both observe the
      // same `previous` snapshot, both append identical-previousValue
      // rows to `notificationSettingsHistory`, and the second writer
      // would silently clobber the first's diff chain. Using
      // `findByKeyTx(tx, …)` adds the doc to the transaction's read
      // set — Firestore retries the closure on conflict, so the diff
      // always reflects the actual previous state at commit time.
      const { historyId } = await db.runTransaction(async (tx) => {
        const previous = await notificationSettingsRepository.findByKeyTx(tx, key, null);
        const diff = computeSettingDiff(previous, setting);
        const ref = db
          .collection(COLLECTIONS.NOTIFICATION_SETTINGS)
          .doc(notificationSettingDocId(key, null));
        tx.set(
          ref,
          {
            id: notificationSettingDocId(key, null),
            key,
            organizationId: null,
            enabled: setting.enabled,
            channels: setting.channels,
            ...(setting.subjectOverride ? { subjectOverride: setting.subjectOverride } : {}),
            updatedAt: setting.updatedAt,
            updatedBy: setting.updatedBy,
          },
          { merge: false },
        );
        const id = await notificationSettingsHistoryRepository.append(
          {
            key,
            organizationId: null,
            previousValue: previous,
            newValue: setting,
            diff,
            actorId: request.user!.uid,
            actorRole: "super_admin",
            ...(body.reason ? { reason: body.reason } : {}),
            changedAt: now,
          },
          tx,
        );
        return { historyId: id };
      });

      // Emit the audit event — the listener wired in Phase 1 routes
      // this into auditLogs under resourceType="notification".
      eventBus.emit("notification.setting_updated", {
        actorId: request.user!.uid,
        requestId: getRequestId(),
        timestamp: now,
        key,
        organizationId: null,
        enabled: body.enabled,
        channels: body.channels,
        hasSubjectOverride: body.subjectOverride !== undefined,
        historyId,
      });

      return reply.send({ success: true, data: setting });
    },
  );

  // ─── Preview (Phase 2.4) ──────────────────────────────────────────────
  // Renders a catalog template with sample params at the requested locale
  // and returns the HTML so the admin UI can drop it into an srcdoc
  // iframe. Pure render — no provider call, no audit side effect.
  const PreviewBodySchema = z.object({
    locale: NotificationLocaleSchema,
    sampleParams: z.record(z.string(), z.unknown()).optional(),
  });

  fastify.post<{
    Params: z.infer<typeof ParamsNotificationKey>;
    Body: z.infer<typeof PreviewBodySchema>;
  }>(
    "/notifications/:key/preview",
    {
      // 60 previews/min per caller (spec). Combines with the global
      // limiter; auth-aware keying is already wired on the global plugin.
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      preHandler: [
        ...adminPreHandler,
        validate({ params: ParamsNotificationKey, body: PreviewBodySchema }),
      ],
      schema: {
        tags: ["Admin", "Notifications"],
        summary: "Render a notification template preview (HTML + subject)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      const { locale, sampleParams } = request.body;

      const definition = NOTIFICATION_CATALOG.find((d) => d.key === key);
      if (!definition) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: `Unknown notification key: ${key}` },
        });
      }

      try {
        const preview = await notificationPreviewService.preview(key, locale, sampleParams ?? {});
        return reply.send({ success: true, data: preview });
      } catch (err) {
        return reply.status(500).send({
          success: false,
          error: {
            code: "PREVIEW_FAILED",
            message: err instanceof Error ? err.message : "Preview render failed",
          },
        });
      }
    },
  );

  // ─── Test send (Phase 2.4) ────────────────────────────────────────────
  // Dispatches the template to an arbitrary email with testMode=true,
  // bypassing admin-disabled / opt-out / suppression / dedup checks.
  const TestSendBodySchema = z.object({
    email: z.string().email(),
    locale: NotificationLocaleSchema,
    sampleParams: z.record(z.string(), z.unknown()).optional(),
    channels: z.array(NotificationChannelSchema).min(1).optional(),
  });

  fastify.post<{
    Params: z.infer<typeof ParamsNotificationKey>;
    Body: z.infer<typeof TestSendBodySchema>;
  }>(
    "/notifications/:key/test-send",
    {
      // 10 sends/hour/admin (spec). Tighter than preview — every send
      // round-trips to Resend, so a runaway "Send" click is costly.
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
      preHandler: [
        ...adminPreHandler,
        validate({ params: ParamsNotificationKey, body: TestSendBodySchema }),
      ],
      schema: {
        tags: ["Admin", "Notifications"],
        summary: "Send a test notification to an arbitrary email",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      const { email, locale, sampleParams, channels } = request.body;

      const definition = NOTIFICATION_CATALOG.find((d) => d.key === key);
      if (!definition) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: `Unknown notification key: ${key}` },
        });
      }

      if (channels) {
        const invalid = channels.filter((c) => !definition.supportedChannels.includes(c));
        if (invalid.length > 0) {
          return reply.status(400).send({
            success: false,
            error: {
              code: "INVALID_CHANNEL",
              message: `Channels ${invalid.join(", ")} not supported for ${key}. Supported: ${definition.supportedChannels.join(", ")}.`,
            },
          });
        }
      }

      // Render the preview subject so the UI can display it in the
      // success toast alongside the delivery confirmation.
      let previewSubject: string | undefined;
      try {
        const preview = await notificationPreviewService.preview(key, locale, sampleParams ?? {});
        previewSubject = preview.subject;
      } catch {
        // Preview failure is non-blocking — still dispatch.
      }

      await notificationDispatcher.dispatch(
        {
          key,
          recipients: [{ email, preferredLocale: locale }],
          params: sampleParams ?? {},
          testMode: true,
          ...(channels ? { channelOverride: channels } : {}),
        },
        { actorId: request.user!.uid },
      );

      return reply.send({
        success: true,
        data: {
          dispatched: true,
          key,
          locale,
          ...(previewSubject ? { previewSubject } : {}),
        },
      });
    },
  );

  // ─── History (Phase 2.4) ──────────────────────────────────────────────
  // Read the append-only edit history for a notification key. Supports
  // optional per-org scoping via `organizationId` query param.
  const HistoryQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(200).default(50),
    organizationId: z.string().min(1).optional(),
  });

  fastify.get<{
    Params: z.infer<typeof ParamsNotificationKey>;
    Querystring: z.infer<typeof HistoryQuerySchema>;
  }>(
    "/notifications/:key/history",
    {
      preHandler: [
        ...adminPreHandler,
        validate({ params: ParamsNotificationKey, query: HistoryQuerySchema }),
      ],
      schema: {
        tags: ["Admin", "Notifications"],
        summary: "List edit history for a notification setting",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      const { limit, organizationId } = request.query;

      const definition = NOTIFICATION_CATALOG.find((d) => d.key === key);
      if (!definition) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: `Unknown notification key: ${key}` },
        });
      }

      const entries = await notificationSettingsHistoryRepository.listByKey(
        key,
        organizationId ?? null,
        limit,
      );

      return reply.send({
        success: true,
        data: { entries, count: entries.length },
      });
    },
  );

  // ─── Per-org overrides list (Phase 2.4) ──────────────────────────────
  fastify.get(
    "/notifications/per-org",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["Admin", "Notifications"],
        summary: "List every notificationSetting override scoped to an organization",
        security: [{ BearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      const overrides = await notificationSettingsRepository.listAllPerOrg();
      return reply.send({ success: true, data: overrides });
    },
  );

  // ─── Notification dispatch metrics (Phase 5 observability) ────────────
  // Aggregates the notificationDispatchLog collection into per-key
  // sent / suppressed counts with suppression-reason breakdown. Powers
  // the admin notifications dashboard widget.
  const NotificationStatsQuery = z.object({
    days: z.coerce.number().int().positive().max(90).default(7),
  });

  fastify.get<{ Querystring: z.infer<typeof NotificationStatsQuery> }>(
    "/notifications/stats",
    {
      preHandler: [...adminPreHandler, validate({ query: NotificationStatsQuery })],
      schema: {
        tags: ["Admin", "Notifications"],
        summary: "Aggregated dispatch stats per notification key",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { days } = request.query;
      const stats = await notificationDispatchLogRepository.aggregateStats(days);
      return reply.send({
        success: true,
        data: { windowDays: days, stats },
      });
    },
  );

  // ─── Delivery observability dashboard (Phase D.3) ─────────────────────
  // Returns per-channel totals + a time-series + suppression breakdown
  // over a caller-chosen window. The 30-day cap matches the dispatch-log
  // TTL horizon so callers can never scroll past "data we still have."
  //
  // Cost envelope: single collection scan, 10k-row hard cap inside the
  // repository method. The caller-facing rate limit (60/min) means a
  // runaway dashboard client can't compound the scan load.

  const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const DeliveryDashboardQuery = z.object({
    key: z.string().min(1).optional(),
    channel: NotificationChannelSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    granularity: z.enum(["hour", "day"]).default("day"),
  });

  fastify.get<{ Querystring: z.infer<typeof DeliveryDashboardQuery> }>(
    "/notifications/delivery",
    {
      preHandler: [...adminPreHandler, validate({ query: DeliveryDashboardQuery })],
      schema: {
        tags: ["Admin", "Notifications"],
        summary: "Delivery outcomes dashboard — per-channel totals + time series",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { key, channel, from, to, granularity } = request.query;

      // Rate-limit BEFORE touching Firestore. Admins clicking through
      // the dashboard can hit 60 req/min easily if they flip filters;
      // we cap at 60/min to stay well inside the 10k-row repository
      // budget and keep observability queries cheap.
      const limitRes = await rateLimit({
        scope: "admin.delivery_dashboard",
        identifier: request.user!.uid,
        limit: 60,
        windowSec: 60,
      });
      if (!limitRes.allowed) {
        // Phase D.L-1 — structured log emitted before the 429 response so
        // ops has a signal for adversarial / misbehaving admin clients
        // without waiting for the endpoint to show up in the Resend-
        // webhook bounce-rate monitor (wrong monitor, different layer).
        // Fields kept minimal: actor (super-admin uid, already non-PII
        // at this layer), count vs limit (so a spike is visible in
        // Cloud Logging dashboards), requestId for cross-log
        // correlation. A downstream log-based metric + alerting policy
        // can layer on top of this line without a code change.
        process.stderr.write(
          JSON.stringify({
            level: "warn",
            event: "admin.delivery_dashboard.rate_limited",
            actorId: request.user!.uid,
            requestId: getRequestId(),
            count: limitRes.count,
            limit: limitRes.limit,
            retryAfterSec: limitRes.retryAfterSec,
          }) + "\n",
        );
        if (limitRes.retryAfterSec !== undefined) {
          reply.header("Retry-After", String(limitRes.retryAfterSec));
        }
        return reply.status(429).send({
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many delivery-dashboard queries. Please wait.",
            ...(limitRes.retryAfterSec !== undefined
              ? { details: { retryAfterSec: limitRes.retryAfterSec } }
              : {}),
          },
        });
      }

      const now = Date.now();
      const toMs = to ? Date.parse(to) : now;
      const fromMs = from ? Date.parse(from) : toMs - DEFAULT_WINDOW_MS;

      if (!Number.isFinite(toMs) || !Number.isFinite(fromMs)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_WINDOW",
            message: "Invalid `from` / `to` timestamp.",
          },
        });
      }

      if (toMs < fromMs) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_WINDOW",
            message: "`to` must be >= `from`.",
          },
        });
      }

      const windowMs = toMs - fromMs;
      if (windowMs > MAX_WINDOW_MS) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "WINDOW_TOO_LARGE",
            message: `Window exceeds ${MAX_WINDOW_MS / (24 * 60 * 60 * 1000)} days — dispatch log TTL horizon.`,
            details: { maxWindowDays: 30 },
          },
        });
      }

      const windowStart = new Date(fromMs).toISOString();
      const windowEnd = new Date(toMs).toISOString();

      const aggregate = await notificationDispatchLogRepository.aggregateDeliveryDashboard({
        windowStart,
        windowEnd,
        granularity,
        ...(key ? { key } : {}),
        ...(channel ? { channel } : {}),
      });

      // Emit the audit event AFTER the aggregation succeeded — an audit
      // row for a query that 500'd is more noise than signal.
      eventBus.emit("admin.delivery_dashboard_viewed", {
        actorId: request.user!.uid,
        requestId: getRequestId(),
        timestamp: new Date().toISOString(),
        ...(key ? { key } : {}),
        ...(channel ? { channel } : {}),
        windowStart,
        windowEnd,
        granularity,
        scanned: aggregate.scanned,
      });

      return reply.send({
        success: true,
        data: {
          range: { from: windowStart, to: windowEnd, granularity },
          totals: aggregate.totals,
          timeseries: aggregate.timeseries,
          perChannel: aggregate.perChannel,
        },
      });
    },
  );
};
