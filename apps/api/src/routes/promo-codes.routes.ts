import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { promoCodeService } from "@/services/promo-code.service";
import {
  type CreatePromoCodeDto,
  type ValidatePromoCodeDto,
  type PromoCodeQuery,
  CreatePromoCodeSchema,
  ValidatePromoCodeSchema,
  PromoCodeQuerySchema,
} from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });
const ParamsWithPromoCodeId = z.object({ promoCodeId: z.string() });

export const promoCodeRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Create Promo Code (organizer) ─────────────────────────────────────────
  fastify.post(
    "/:eventId/promo-codes",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId, body: CreatePromoCodeSchema }),
      ],
      schema: { tags: ["Promo Codes"], summary: "Create a promo code for an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const body = request.body as CreatePromoCodeDto;
      const promoCode = await promoCodeService.createPromoCode(
        { ...body, eventId },
        request.user!,
      );
      return reply.status(201).send({ success: true, data: promoCode });
    },
  );

  // ─── List Promo Codes (organizer) ──────────────────────────────────────────
  fastify.get(
    "/:eventId/promo-codes",
    {
      preHandler: [
        authenticate,
        requirePermission("event:read"),
        validate({ params: ParamsWithEventId, query: PromoCodeQuerySchema }),
      ],
      schema: { tags: ["Promo Codes"], summary: "List promo codes for an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const query = request.query as PromoCodeQuery;
      const result = await promoCodeService.listPromoCodes(eventId, query, request.user!);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Validate Promo Code (public — no auth) ───────────────────────────────
  fastify.post(
    "/:eventId/promo-codes/validate",
    {
      preHandler: [
        validate({
          params: ParamsWithEventId,
          body: ValidatePromoCodeSchema.omit({ eventId: true }),
        }),
      ],
      schema: { tags: ["Promo Codes"], summary: "Validate a promo code (public)" },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { code, ticketTypeId } = request.body as Omit<ValidatePromoCodeDto, "eventId">;
      const result = await promoCodeService.validatePromoCode(eventId, code, ticketTypeId);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Deactivate Promo Code (organizer) ─────────────────────────────────────
  fastify.delete(
    "/promo-codes/:promoCodeId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithPromoCodeId }),
      ],
      schema: { tags: ["Promo Codes"], summary: "Deactivate a promo code", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { promoCodeId } = request.params as z.infer<typeof ParamsWithPromoCodeId>;
      await promoCodeService.deactivatePromoCode(promoCodeId, request.user!);
      return reply.status(204).send();
    },
  );
};
