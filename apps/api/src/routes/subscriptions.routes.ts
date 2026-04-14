import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { subscriptionService } from "@/services/subscription.service";
import { UpgradePlanSchema, DowngradePlanSchema } from "@teranga/shared-types";

const ParamsOrgId = z.object({ orgId: z.string() });

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/organizations/:orgId/subscription
  app.get<{ Params: z.infer<typeof ParamsOrgId> }>(
    "/v1/organizations/:orgId/subscription",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:manage_billing"),
        validate({ params: ParamsOrgId }),
      ],
    },
    async (request, reply) => {
      const subscription = await subscriptionService.getSubscription(
        request.params.orgId,
        request.user!,
      );
      return reply.send({ success: true, data: subscription });
    },
  );

  // GET /v1/organizations/:orgId/usage
  app.get<{ Params: z.infer<typeof ParamsOrgId> }>(
    "/v1/organizations/:orgId/usage",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:read"),
        validate({ params: ParamsOrgId }),
      ],
    },
    async (request, reply) => {
      const usage = await subscriptionService.getUsage(request.params.orgId, request.user!);
      return reply.send({ success: true, data: usage });
    },
  );

  // POST /v1/organizations/:orgId/subscription/upgrade
  app.post<{
    Params: z.infer<typeof ParamsOrgId>;
    Body: z.infer<typeof UpgradePlanSchema>;
  }>(
    "/v1/organizations/:orgId/subscription/upgrade",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("organization:manage_billing"),
        validate({ params: ParamsOrgId, body: UpgradePlanSchema }),
      ],
    },
    async (request, reply) => {
      const subscription = await subscriptionService.upgrade(
        request.params.orgId,
        request.body,
        request.user!,
      );
      return reply.status(200).send({ success: true, data: subscription });
    },
  );

  // POST /v1/organizations/:orgId/subscription/downgrade
  app.post<{
    Params: z.infer<typeof ParamsOrgId>;
    Body: z.infer<typeof DowngradePlanSchema>;
  }>(
    "/v1/organizations/:orgId/subscription/downgrade",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("organization:manage_billing"),
        validate({ params: ParamsOrgId, body: DowngradePlanSchema }),
      ],
    },
    async (request, reply) => {
      await subscriptionService.downgrade(request.params.orgId, request.body.plan, request.user!);
      return reply.send({ success: true, data: null });
    },
  );

  // POST /v1/organizations/:orgId/subscription/cancel
  app.post<{ Params: z.infer<typeof ParamsOrgId> }>(
    "/v1/organizations/:orgId/subscription/cancel",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("organization:manage_billing"),
        validate({ params: ParamsOrgId }),
      ],
    },
    async (request, reply) => {
      await subscriptionService.cancel(request.params.orgId, request.user!);
      return reply.send({ success: true, data: null });
    },
  );
};
