/**
 * Organizer overhaul — Phase O6.
 *
 * Two route surfaces:
 *
 *  1. Participant-scoped opt-in management — under `/v1/me/whatsapp`.
 *     The participant grants / revokes / inspects their own consent;
 *     the organisation id is required because consent is org-scoped
 *     (a participant inscribed at two orgs may opt in to one and
 *     refuse the other).
 *
 *  2. Meta delivery webhook — `POST /v1/whatsapp/webhooks/delivery`.
 *     Public endpoint (no `authenticate` middleware) because Meta
 *     calls it directly. Signature verification happens via the
 *     dedicated middleware (placeholder in dev — wired to Meta's
 *     `X-Hub-Signature-256` header in production). Delivery status
 *     updates land in the `whatsappDeliveryLog` collection;
 *     `failed` updates also fire a domain event for the audit log.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { whatsappWebhookSignature } from "@/middlewares/whatsapp-webhook-signature.middleware";
import { whatsappOptInService } from "@/services/whatsapp-opt-in.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import { CreateWhatsappOptInSchema, WhatsappDeliveryWebhookSchema } from "@teranga/shared-types";

const RevokeQuery = z.object({ organizationId: z.string().min(1) });

export const whatsappMeRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Grant Opt-In ─────────────────────────────────────────────────────
  // W10-P2 / S3 — opt-in is the door to the per-org WhatsApp template
  // send budget. A spammer who hijacked a session could grant + revoke
  // in a loop to inflate Meta cost telemetry. Cap at 10 grants per
  // minute per caller — well above legitimate user behaviour (one
  // toggle per organisation per session) but below any economic abuse
  // threshold.
  fastify.post(
    "/opt-in",
    {
      preHandler: [authenticate, validate({ body: CreateWhatsappOptInSchema })],
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        tags: ["WhatsApp"],
        summary: "Grant WhatsApp opt-in for the calling user (org-scoped)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const dto = request.body as z.infer<typeof CreateWhatsappOptInSchema>;
      const optIn = await whatsappOptInService.grant(request.user!, dto);
      return reply.status(201).send({ success: true, data: optIn });
    },
  );

  // ─── Revoke Opt-In ────────────────────────────────────────────────────
  // Symmetrical 10/min cap — see grant rationale above.
  fastify.delete(
    "/opt-in",
    {
      preHandler: [authenticate, validate({ query: RevokeQuery })],
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        tags: ["WhatsApp"],
        summary: "Revoke a previously-granted WhatsApp opt-in",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { organizationId } = request.query as z.infer<typeof RevokeQuery>;
      const optIn = await whatsappOptInService.revoke(request.user!, organizationId);
      return reply.send({ success: true, data: optIn });
    },
  );

  // ─── Read current Opt-In state ─────────────────────────────────────────
  fastify.get(
    "/opt-in",
    {
      preHandler: [authenticate, validate({ query: RevokeQuery })],
      schema: {
        tags: ["WhatsApp"],
        summary: "Read the current WhatsApp opt-in record (or null)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { organizationId } = request.query as z.infer<typeof RevokeQuery>;
      const optIn = await whatsappOptInService.get(request.user!, organizationId);
      return reply.send({ success: true, data: optIn });
    },
  );
};

export const whatsappPublicRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Meta Delivery Webhook (public — verified by signature) ───────────
  // Stores every status update in `whatsappDeliveryLog`. `failed`
  // events also fire a domain event so the audit listener captures
  // the failure for compliance review.
  fastify.post(
    "/webhooks/delivery",
    {
      // Signature verification runs BEFORE Zod validation so a
      // malformed body from an unauthorised caller is rejected with
      // 403 instead of 400 — denies signal to attackers probing the
      // endpoint shape. The middleware is fail-OPEN when
      // WHATSAPP_APP_SECRET is unset (dev / mock-transport posture)
      // and fail-CLOSED in production. The path matches
      // `/webhooks/` (plural) so the JSON content-type parser
      // registered in payments.routes.ts attaches `rawBody` for the
      // HMAC-SHA256 compute.
      preHandler: [whatsappWebhookSignature, validate({ body: WhatsappDeliveryWebhookSchema })],
      schema: {
        tags: ["WhatsApp"],
        summary: "Receive Meta WhatsApp delivery status updates",
      },
    },
    async (request, reply) => {
      const dto = request.body as z.infer<typeof WhatsappDeliveryWebhookSchema>;
      const ctx = getRequestContext();
      const requestId = ctx?.requestId ?? "unknown";

      // Append to the delivery log (id = messageId for idempotency:
      // Meta retries a failed webhook delivery — using messageId as
      // doc id makes the second arrival a no-op on the same status).
      await db
        .collection(COLLECTIONS.WHATSAPP_DELIVERY_LOG)
        .doc(`${dto.messageId}__${dto.status}`)
        .set({
          ...dto,
          receivedAt: new Date().toISOString(),
        });

      if (dto.status === "failed") {
        eventBus.emit("whatsapp.delivery.failed", {
          messageId: dto.messageId,
          recipient: dto.recipient,
          errorCode: dto.errorCode ?? null,
          errorMessage: dto.errorMessage ?? null,
          actorId: "meta-webhook",
          requestId,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({ success: true });
    },
  );
};
