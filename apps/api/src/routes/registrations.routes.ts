import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission, requireAnyPermission } from "@/middlewares/permission.middleware";
import { registrationService } from "@/services/registration.service";
import { PaginationSchema } from "@teranga/shared-types";

const RegisterBody = z.object({
  eventId: z.string(),
  ticketTypeId: z.string(),
});

const CheckInBody = z.object({
  qrCodeValue: z.string(),
  accessZoneId: z.string().optional(),
});

const ParamsWithRegistrationId = z.object({ registrationId: z.string() });

export const registrationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Register for an Event ───────────────────────────────────────────────
  fastify.post(
    "/",
    {
      preHandler: [authenticate, requirePermission("registration:create"), validate({ body: RegisterBody })],
      schema: { tags: ["Registrations"], summary: "Register for an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId, ticketTypeId } = request.body as z.infer<typeof RegisterBody>;
      const registration = await registrationService.register(eventId, ticketTypeId, request.user!);
      return reply.status(201).send({ success: true, data: registration });
    },
  );

  // ─── Get My Registrations ────────────────────────────────────────────────
  fastify.get(
    "/me",
    {
      preHandler: [authenticate, validate({ query: PaginationSchema })],
      schema: { tags: ["Registrations"], summary: "Get my registrations", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const pagination = request.query as z.infer<typeof PaginationSchema>;
      const result = await registrationService.getMyRegistrations(request.user!, pagination);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Get Event Registrations (organizer) ─────────────────────────────────
  fastify.get(
    "/event/:eventId",
    {
      preHandler: [
        authenticate,
        requirePermission("registration:read_all"),
        validate({ params: z.object({ eventId: z.string() }), query: PaginationSchema }),
      ],
      schema: { tags: ["Registrations"], summary: "List registrations for an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const pagination = request.query as z.infer<typeof PaginationSchema>;
      const result = await registrationService.getEventRegistrations(eventId, request.user!, undefined, pagination);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Cancel Registration ─────────────────────────────────────────────────
  fastify.delete(
    "/:registrationId",
    {
      preHandler: [authenticate, requireAnyPermission(["registration:cancel_own", "registration:cancel_any"]), validate({ params: ParamsWithRegistrationId })],
      schema: { tags: ["Registrations"], summary: "Cancel a registration", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { registrationId } = request.params as z.infer<typeof ParamsWithRegistrationId>;
      await registrationService.cancel(registrationId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── Approve Registration ────────────────────────────────────────────────
  fastify.post(
    "/:registrationId/approve",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("registration:approve"),
        validate({ params: ParamsWithRegistrationId }),
      ],
      schema: { tags: ["Registrations"], summary: "Approve a pending registration", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { registrationId } = request.params as z.infer<typeof ParamsWithRegistrationId>;
      await registrationService.approve(registrationId, request.user!);
      return reply.send({ success: true, data: { id: registrationId, status: "confirmed" } });
    },
  );

  // ─── Check-in (QR Scan) ──────────────────────────────────────────────────
  fastify.post(
    "/checkin",
    {
      preHandler: [authenticate, requirePermission("checkin:scan"), validate({ body: CheckInBody })],
      schema: { tags: ["Registrations"], summary: "Check-in via QR code", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { qrCodeValue, accessZoneId } = request.body as z.infer<typeof CheckInBody>;
      const result = await registrationService.checkIn(qrCodeValue, request.user!, accessZoneId);
      return reply.send({ success: true, data: result });
    },
  );
};
