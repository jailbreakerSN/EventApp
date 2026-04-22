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
  type NotificationDefinition,
} from "@teranga/shared-types";
import { notificationSettingsRepository } from "@/repositories/notification-settings.repository";
import { notificationDispatchLogRepository } from "@/repositories/notification-dispatch-log.repository";
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
  const UpdateNotificationSettingBody = NotificationSettingSchema.pick({
    enabled: true,
    channels: true,
    subjectOverride: true,
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
      const setting = {
        key,
        enabled: body.enabled,
        channels: body.channels,
        ...(body.subjectOverride ? { subjectOverride: body.subjectOverride } : {}),
        updatedAt: now,
        updatedBy: request.user!.uid,
      };

      await notificationSettingsRepository.upsert(setting);

      // Emit the audit event — the listener wired in Phase 1 routes
      // this into auditLogs under resourceType="notification".
      eventBus.emit("notification.setting_updated", {
        actorId: request.user!.uid,
        requestId: getRequestId(),
        timestamp: now,
        key,
        enabled: body.enabled,
        channels: body.channels,
        hasSubjectOverride: body.subjectOverride !== undefined,
      });

      return reply.send({ success: true, data: setting });
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
};
