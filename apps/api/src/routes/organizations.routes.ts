import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { organizationService } from "@/services/organization.service";
import { inviteService } from "@/services/invite.service";
import { analyticsService } from "@/services/analytics.service";
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
  CreateInviteSchema,
  AnalyticsQuerySchema,
  OrgMemberRoleSchema,
} from "@teranga/shared-types";

const ParamsWithOrgId = z.object({ orgId: z.string() });
const ParamsWithOrgIdAndMemberId = z.object({ orgId: z.string(), memberId: z.string() });

const AddMemberBody = z.object({
  userId: z.string(),
});

const RemoveMemberBody = z.object({
  userId: z.string(),
});

const UpdateMemberRoleBody = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});

export const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Create Organization ─────────────────────────────────────────────────
  fastify.post(
    "/",
    {
      preHandler: [authenticate, requirePermission("organization:create"), validate({ body: CreateOrganizationSchema })],
      schema: { tags: ["Organizations"], summary: "Create organization", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const org = await organizationService.create(request.body as any, request.user!);
      return reply.status(201).send({ success: true, data: org });
    },
  );

  // ─── Get Organization ────────────────────────────────────────────────────
  fastify.get(
    "/:orgId",
    {
      preHandler: [authenticate, requirePermission("organization:read"), validate({ params: ParamsWithOrgId })],
      schema: { tags: ["Organizations"], summary: "Get organization by ID", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const org = await organizationService.getById(orgId, request.user!);
      return reply.send({ success: true, data: org });
    },
  );

  // ─── Update Organization ─────────────────────────────────────────────────
  fastify.patch(
    "/:orgId",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:update"),
        validate({ params: ParamsWithOrgId, body: UpdateOrganizationSchema }),
      ],
      schema: { tags: ["Organizations"], summary: "Update organization", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      await organizationService.update(orgId, request.body as any, request.user!);
      return reply.send({ success: true, data: { id: orgId } });
    },
  );

  // ─── Add Member ──────────────────────────────────────────────────────────
  fastify.post(
    "/:orgId/members",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:manage_members"),
        validate({ params: ParamsWithOrgId, body: AddMemberBody }),
      ],
      schema: { tags: ["Organizations"], summary: "Add organization member", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const { userId } = request.body as z.infer<typeof AddMemberBody>;
      await organizationService.addMember(orgId, userId, request.user!);
      return reply.status(201).send({ success: true, data: { orgId, userId } });
    },
  );

  // ─── Remove Member ───────────────────────────────────────────────────────
  fastify.delete(
    "/:orgId/members",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:manage_members"),
        validate({ params: ParamsWithOrgId, body: RemoveMemberBody }),
      ],
      schema: { tags: ["Organizations"], summary: "Remove organization member", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const { userId } = request.body as z.infer<typeof RemoveMemberBody>;
      await organizationService.removeMember(orgId, userId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── Update Member Role ──────────────────────────────────────────────────
  fastify.patch(
    "/:orgId/members/:memberId/role",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:manage_members"),
        validate({ params: ParamsWithOrgIdAndMemberId, body: UpdateMemberRoleBody }),
      ],
      schema: { tags: ["Organizations"], summary: "Update organization member role", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId, memberId } = request.params as z.infer<typeof ParamsWithOrgIdAndMemberId>;
      const { role } = request.body as z.infer<typeof UpdateMemberRoleBody>;
      await organizationService.updateMemberRole(orgId, memberId, role, request.user!);
      return reply.send({ success: true, data: { orgId, userId: memberId, role } });
    },
  );

  // ─── Invitations ────────────────────────────────────────────────────────

  fastify.post(
    "/:orgId/invites",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:manage_members"),
        validate({ params: ParamsWithOrgId, body: CreateInviteSchema }),
      ],
      schema: { tags: ["Organizations"], summary: "Create organization invite", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const invite = await inviteService.createInvite(orgId, request.body as any, request.user!);
      // Strip secret token from response — token should only be sent via email
      const { token: _token, ...safeInvite } = invite;
      return reply.status(201).send({ success: true, data: safeInvite });
    },
  );

  fastify.get(
    "/:orgId/invites",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:read"),
        validate({ params: ParamsWithOrgId }),
      ],
      schema: { tags: ["Organizations"], summary: "List organization invites", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const invites = await inviteService.listByOrganization(orgId, request.user!);
      // Strip tokens from list response
      const safeInvites = invites.map(({ token: _t, ...rest }) => rest);
      return reply.send({ success: true, data: safeInvites });
    },
  );

  fastify.delete(
    "/:orgId/invites/:inviteId",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:manage_members"),
        validate({ params: z.object({ orgId: z.string(), inviteId: z.string() }) }),
      ],
      schema: { tags: ["Organizations"], summary: "Revoke an invitation", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { inviteId } = request.params as { inviteId: string };
      await inviteService.revokeInvite(inviteId, request.user!);
      return reply.status(204).send();
    },
  );

  // ──��� Analytics ────────��─────────────────────────────────────────────────

  fastify.get(
    "/:orgId/analytics",
    {
      preHandler: [
        authenticate,
        requirePermission("event:read"),
        validate({ params: ParamsWithOrgId, query: AnalyticsQuerySchema }),
      ],
      schema: { tags: ["Organizations"], summary: "Get organization analytics", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const analytics = await analyticsService.getOrgAnalytics(orgId, request.query as any, request.user!);
      return reply.send({ success: true, data: analytics });
    },
  );
};
