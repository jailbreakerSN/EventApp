import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { planCouponService } from "@/services/plan-coupon.service";
import { planRepository } from "@/repositories/plan.repository";
import { NotFoundError, PlanLimitError } from "@/errors/app-error";
import {
  CreatePlanCouponSchema,
  UpdatePlanCouponSchema,
  AdminCouponQuerySchema,
  ValidateCouponRequestSchema,
  isAdminSystemRole,
} from "@teranga/shared-types";

const ParamsWithCouponId = z.object({ couponId: z.string() });
const ParamsWithPlanId = z.object({ planId: z.string() });
const ValidateCouponQuery = z.object({ organizationId: z.string() });

/**
 * Admin coupon routes (super-admin only).
 *
 * Mounted at `/v1/admin/coupons` — `platform:manage` required on every
 * endpoint. Redemptions are read-only through the billing UI; the admin
 * surface is focused on lifecycle (create/update/archive).
 */
export const adminCouponRoutes: FastifyPluginAsync = async (fastify) => {
  const preHandler = [authenticate, requirePermission("platform:manage")];

  fastify.get(
    "/",
    {
      preHandler: [...preHandler, validate({ query: AdminCouponQuerySchema })],
      schema: {
        tags: ["Admin", "Coupons"],
        summary: "List plan-level coupons",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const query = request.query as z.infer<typeof AdminCouponQuerySchema>;
      const result = await planCouponService.list(query, request.user!);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  fastify.get(
    "/:couponId",
    {
      preHandler: [...preHandler, validate({ params: ParamsWithCouponId })],
      schema: {
        tags: ["Admin", "Coupons"],
        summary: "Get a coupon by id",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { couponId } = request.params as z.infer<typeof ParamsWithCouponId>;
      const coupon = await planCouponService.get(couponId, request.user!);
      return reply.send({ success: true, data: coupon });
    },
  );

  fastify.post(
    "/",
    {
      preHandler: [...preHandler, validate({ body: CreatePlanCouponSchema })],
      schema: {
        tags: ["Admin", "Coupons"],
        summary: "Create a plan-level coupon",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const coupon = await planCouponService.create(
        request.body as z.infer<typeof CreatePlanCouponSchema>,
        request.user!,
      );
      return reply.status(201).send({ success: true, data: coupon });
    },
  );

  fastify.patch(
    "/:couponId",
    {
      preHandler: [
        ...preHandler,
        validate({ params: ParamsWithCouponId, body: UpdatePlanCouponSchema }),
      ],
      schema: {
        tags: ["Admin", "Coupons"],
        summary: "Update a coupon (partial)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { couponId } = request.params as z.infer<typeof ParamsWithCouponId>;
      const coupon = await planCouponService.update(
        couponId,
        request.body as z.infer<typeof UpdatePlanCouponSchema>,
        request.user!,
      );
      return reply.send({ success: true, data: coupon });
    },
  );

  fastify.delete(
    "/:couponId",
    {
      preHandler: [...preHandler, validate({ params: ParamsWithCouponId })],
      schema: {
        tags: ["Admin", "Coupons"],
        summary: "Archive a coupon (soft-delete)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { couponId } = request.params as z.infer<typeof ParamsWithCouponId>;
      await planCouponService.archive(couponId, request.user!);
      return reply.status(204).send();
    },
  );
};

/**
 * Public coupon validation route (authenticated).
 *
 * `POST /v1/plans/:planId/validate-coupon` — used by the billing
 * upgrade UI to preview the discount BEFORE submit. Rate-limited
 * aggressively (misbehaving UI or brute-force scanning a code space
 * from a single token shouldn't exhaust Firestore quota).
 *
 * Because the route is public but we check a tenant-scoped cap
 * (`maxUsesPerOrg`), the caller must pass `organizationId` on the
 * query string. The permission layer ensures the caller is a member
 * of that org (`organization:manage_billing`) — validation fails
 * before any Firestore read if they're not.
 */
export const publicCouponRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/:planId/validate-coupon",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      preHandler: [
        authenticate,
        requirePermission("organization:manage_billing"),
        validate({
          params: ParamsWithPlanId,
          body: ValidateCouponRequestSchema,
          query: ValidateCouponQuery,
        }),
      ],
      schema: {
        tags: ["Plans", "Coupons"],
        summary: "Validate a coupon code against a plan (dry-run)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { planId } = request.params as z.infer<typeof ParamsWithPlanId>;
      const body = request.body as z.infer<typeof ValidateCouponRequestSchema>;
      const { organizationId } = request.query as z.infer<typeof ValidateCouponQuery>;

      // Caller must belong to the target organization — coupon caps are
      // per-org, and we don't want one org probing another org's cap
      // state by passing someone else's orgId.
      const user = request.user!;
      const isAdmin = user.roles.some(isAdminSystemRole);
      if (!isAdmin && user.organizationId !== organizationId) {
        return reply.status(403).send({
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Vous n'avez pas accès à cette organisation.",
          },
        });
      }

      const plan = await planRepository.findById(planId);
      if (!plan) throw new NotFoundError("Plan", planId);

      // ── Security: collapse negative previews into a single generic
      // error code so the endpoint doesn't leak coupon lifecycle state
      // (exists / active / expired / exhausted / wrong-plan / wrong-cycle)
      // to authenticated tenants brute-forcing the code space. The real
      // upgrade path re-runs the validation inside a transaction and
      // surfaces the SPECIFIC reason there — the caller already has the
      // code from an out-of-band channel at that point, so there's no
      // disclosure concern. Only the public preview needs to be opaque.
      try {
        const result = await planCouponService.validateForPreview({
          code: body.code,
          plan,
          cycle: body.cycle,
          organizationId,
        });
        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof PlanLimitError) {
          return reply.status(400).send({
            success: false,
            error: {
              code: "COUPON_NOT_APPLICABLE",
              message: "Ce coupon n'est pas applicable à cet abonnement.",
            },
          });
        }
        throw err;
      }
    },
  );
};
