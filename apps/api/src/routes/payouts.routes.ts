import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { payoutService } from "@/services/payout.service";
import { CreatePayoutSchema, PayoutQuerySchema } from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });
const ParamsWithOrgId = z.object({ orgId: z.string() });
const ParamsWithPayoutId = z.object({ payoutId: z.string() });

const CalculateQuery = z.object({
  periodFrom: z.string(),
  periodTo: z.string(),
});

export const payoutRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Calculate Payout Preview ─────────────────────────────────────────
  fastify.get(
    "/event/:eventId/calculate",
    {
      preHandler: [
        authenticate,
        requirePermission("payout:read"),
        validate({ params: ParamsWithEventId, query: CalculateQuery }),
      ],
      schema: {
        tags: ["Payouts"],
        summary: "Preview payout calculation for an event period",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { periodFrom, periodTo } = request.query as z.infer<typeof CalculateQuery>;
      const result = await payoutService.calculatePayout(eventId, periodFrom, periodTo, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Create Payout ────────────────────────────────────────────────────
  fastify.post(
    "/event/:eventId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("payout:create"),
        validate({ params: ParamsWithEventId, body: CreatePayoutSchema }),
      ],
      schema: {
        tags: ["Payouts"],
        summary: "Create a payout for an event period",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { periodFrom, periodTo } = request.body as z.infer<typeof CreatePayoutSchema>;
      const payout = await payoutService.createPayout(eventId, periodFrom, periodTo, request.user!);
      return reply.status(201).send({ success: true, data: payout });
    },
  );

  // ─── List Organization Payouts ────────────────────────────────────────
  fastify.get(
    "/organization/:orgId",
    {
      preHandler: [
        authenticate,
        requirePermission("payout:read"),
        validate({ params: ParamsWithOrgId, query: PayoutQuerySchema }),
      ],
      schema: {
        tags: ["Payouts"],
        summary: "List payouts for an organization",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const { status, page, limit } = request.query as z.infer<typeof PayoutQuerySchema>;
      const result = await payoutService.listPayouts(orgId, { status }, { page: page ?? 1, limit: limit ?? 20 }, request.user!);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Get Payout Detail ────────────────────────────────────────────────
  fastify.get(
    "/:payoutId",
    {
      preHandler: [
        authenticate,
        requirePermission("payout:read"),
        validate({ params: ParamsWithPayoutId }),
      ],
      schema: {
        tags: ["Payouts"],
        summary: "Get payout detail",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { payoutId } = request.params as z.infer<typeof ParamsWithPayoutId>;
      const payout = await payoutService.getPayoutDetail(payoutId, request.user!);
      return reply.send({ success: true, data: payout });
    },
  );
};
