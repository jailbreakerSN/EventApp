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
} from "@teranga/shared-types";

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
};
