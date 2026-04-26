import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission, requireAnyPermission } from "@/middlewares/permission.middleware";
import { registrationService } from "@/services/registration.service";
import { registrationBulkService } from "@/services/registration-bulk.service";
import {
  PaginationSchema,
  CheckInRequestSchema,
  BulkRegistrationActionSchema,
} from "@teranga/shared-types";

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

  // ─── Waitlist position (B2 — Phase 7+) ───────────────────────────────────
  // Surfaces "you're 5 / 12 in line" to a participant looking at their
  // own waitlisted registration, plus organizers reading any of their
  // org's registrations. Returns null when the registration is not
  // currently waitlisted (no stale position on confirmed/cancelled docs).
  fastify.get(
    "/:registrationId/waitlist-position",
    {
      preHandler: [
        authenticate,
        // `registration:read_own` is the minimum bound — owners need it
        // to read their own waitlist position. Organizers' read access
        // for foreign registrations is enforced inside the service via
        // `requireOrganizationAccess` + `registration:read_all`. Adding
        // the route-level gate prevents any caller missing the basic
        // read permission (e.g. a malformed API key with no scope) from
        // reaching the service at all. Aligns with every other
        // `/v1/registrations` read surface.
        requirePermission("registration:read_own"),
        validate({ params: ParamsWithRegistrationId }),
      ],
      schema: {
        tags: ["Registrations"],
        summary: "Get a participant's position on the waitlist (FIFO within ticket type)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { registrationId } = request.params as z.infer<typeof ParamsWithRegistrationId>;
      const result = await registrationService.getWaitlistPosition(registrationId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Check-in (QR Scan) ──────────────────────────────────────────────────
  // Per-route rate-limit override (ADR-0015): staff scanners legitimately
  // burst much faster than the global `user:*` 120/min budget would
  // allow — a busy event entrance can sustain ~3 scans/sec. We grant
  // 200/min per scanner here. Brute-force is not the threat on this
  // endpoint (the QR is signed and the staff is permission-gated); the
  // limit is a back-pressure cap to protect the service, not an
  // anti-abuse gate.
  fastify.post(
    "/checkin",
    {
      config: {
        rateLimit: {
          max: 200,
          timeWindow: "1 minute",
        },
      },
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

  // ─── Bulk cancel (Phase O7) ──────────────────────────────────────────
  // Sequential per-row cancellation; per-row failures are collected
  // and returned to the UI rather than aborting the whole batch.
  fastify.post(
    "/bulk-cancel",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("registration:cancel_any"),
        validate({ body: BulkRegistrationActionSchema }),
      ],
      schema: {
        tags: ["Registrations"],
        summary: "Bulk-cancel many registrations (per-row failures collected)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const dto = request.body as z.infer<typeof BulkRegistrationActionSchema>;
      const result = await registrationBulkService.bulkCancel(dto.registrationIds, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Bulk approve (Phase O7) — promote N waitlisted at once ─────────
  fastify.post(
    "/bulk-approve",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("registration:approve"),
        validate({ body: BulkRegistrationActionSchema }),
      ],
      schema: {
        tags: ["Registrations"],
        summary: "Bulk-approve many waitlisted registrations",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const dto = request.body as z.infer<typeof BulkRegistrationActionSchema>;
      const result = await registrationBulkService.bulkApprove(dto.registrationIds, request.user!);
      return reply.send({ success: true, data: result });
    },
  );
};
