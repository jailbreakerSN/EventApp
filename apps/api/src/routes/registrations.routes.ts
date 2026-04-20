import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission, requireAnyPermission } from "@/middlewares/permission.middleware";
import { registrationService } from "@/services/registration.service";
import { PaginationSchema, CheckInRequestSchema } from "@teranga/shared-types";

const RegisterBody = z.object({
  eventId: z.string(),
  ticketTypeId: z.string(),
});

// Route body schema is imported from `@teranga/shared-types` — keeping it
// there lets the Flutter scanner + web-backoffice check-in UI build
// against the same contract. Scanner attestation fields (`scannerDeviceId`,
// `scannerNonce`) are optional on the wire so older mobile builds still
// work; server persists what's provided and carries the rest as `null`
// in the audit trail.
const CheckInBody = CheckInRequestSchema;

const ParamsWithRegistrationId = z.object({ registrationId: z.string() });

export const registrationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Register for an Event ───────────────────────────────────────────────
  fastify.post(
    "/",
    {
      preHandler: [
        authenticate,
        requirePermission("registration:create"),
        validate({ body: RegisterBody }),
      ],
      schema: {
        tags: ["Registrations"],
        summary: "Register for an event",
        security: [{ BearerAuth: [] }],
      },
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
      schema: {
        tags: ["Registrations"],
        summary: "Get my registrations",
        security: [{ BearerAuth: [] }],
      },
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
      schema: {
        tags: ["Registrations"],
        summary: "List registrations for an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const pagination = request.query as z.infer<typeof PaginationSchema>;
      const result = await registrationService.getEventRegistrations(
        eventId,
        request.user!,
        undefined,
        pagination,
      );
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Cancel Registration ─────────────────────────────────────────────────
  fastify.delete(
    "/:registrationId",
    {
      preHandler: [
        authenticate,
        requireAnyPermission(["registration:cancel_own", "registration:cancel_any"]),
        validate({ params: ParamsWithRegistrationId }),
      ],
      schema: {
        tags: ["Registrations"],
        summary: "Cancel a registration",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { registrationId } = request.params as z.infer<typeof ParamsWithRegistrationId>;
      await registrationService.cancel(registrationId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── Cancel Registration (POST alias) ────────────────────────────────────
  // Both the participant web app (`registrationsApi.cancel`) and the
  // backoffice registrations table POST here. Historically the route was
  // DELETE-only, which meant every "Annuler" button in the UI hit a 404
  // silently — the apps' API clients were never aligned with the route.
  // Keep DELETE as the canonical REST form; POST is an alias so neither
  // frontend has to change.
  fastify.post(
    "/:registrationId/cancel",
    {
      preHandler: [
        authenticate,
        requireAnyPermission(["registration:cancel_own", "registration:cancel_any"]),
        validate({ params: ParamsWithRegistrationId }),
      ],
      schema: {
        tags: ["Registrations"],
        summary: "Cancel a registration (POST alias for DELETE)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { registrationId } = request.params as z.infer<typeof ParamsWithRegistrationId>;
      await registrationService.cancel(registrationId, request.user!);
      return reply.send({ success: true, data: { id: registrationId, status: "cancelled" } });
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
      schema: {
        tags: ["Registrations"],
        summary: "Approve a pending registration",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { registrationId } = request.params as z.infer<typeof ParamsWithRegistrationId>;
      await registrationService.approve(registrationId, request.user!);
      return reply.send({ success: true, data: { id: registrationId, status: "confirmed" } });
    },
  );

  // ─── Promote Registration (PATCH status=confirmed) ───────────────────────
  // The backoffice `registrationsApi.promote` PATCHes `{status: "confirmed"}`
  // here. Before this route existed the call silently 404'd. We only honour
  // a narrow set of target statuses — promote (confirmed) and cancel —
  // because arbitrary status mutations skip the domain-event emissions
  // that approve/cancel go through. A broader status-machine belongs in
  // a dedicated service method if it's ever needed.
  fastify.patch(
    "/:registrationId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        validate({
          params: ParamsWithRegistrationId,
          body: z.object({ status: z.enum(["confirmed", "cancelled"]) }),
        }),
      ],
      schema: {
        tags: ["Registrations"],
        summary: "Update registration status (promote or cancel)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { registrationId } = request.params as z.infer<typeof ParamsWithRegistrationId>;
      const { status } = request.body as { status: "confirmed" | "cancelled" };
      if (status === "confirmed") {
        // Route to the approve path so permission check + event emission
        // stay consistent with POST /approve. A waitlisted → confirmed
        // promotion walks the same code path.
        // requirePermission("registration:approve") is enforced inside
        // registrationService.approve via BaseService.requirePermission.
        await registrationService.approve(registrationId, request.user!);
        return reply.send({ success: true, data: { id: registrationId, status: "confirmed" } });
      }
      // status === "cancelled"
      await registrationService.cancel(registrationId, request.user!);
      return reply.send({ success: true, data: { id: registrationId, status: "cancelled" } });
    },
  );

  // ─── Check-in (QR Scan) ──────────────────────────────────────────────────
  fastify.post(
    "/checkin",
    {
      preHandler: [
        authenticate,
        requirePermission("checkin:scan"),
        validate({ body: CheckInBody }),
      ],
      schema: {
        tags: ["Registrations"],
        summary: "Check-in via QR code",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { qrCodeValue, accessZoneId, scannerDeviceId, scannerNonce } = request.body as z.infer<
        typeof CheckInBody
      >;
      const result = await registrationService.checkIn(qrCodeValue, request.user!, {
        accessZoneId,
        scannerDeviceId,
        scannerNonce,
      });
      return reply.send({ success: true, data: result });
    },
  );
};
