import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { speakerService } from "@/services/speaker.service";
import { CreateSpeakerSchema, UpdateSpeakerSchema, SpeakerQuerySchema } from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });
const ParamsWithSpeakerId = z.object({ speakerId: z.string() });

export const speakerRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Add Speaker to Event ─────────────────────────────────────────────
  fastify.post(
    "/:eventId/speakers",
    {
      preHandler: [
        authenticate,
        requirePermission("event:manage_speakers"),
        validate({ params: ParamsWithEventId, body: CreateSpeakerSchema }),
      ],
      schema: {
        tags: ["Speakers"],
        summary: "Add a speaker to an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const dto = request.body as z.infer<typeof CreateSpeakerSchema>;
      const speaker = await speakerService.createSpeaker(dto, request.user!);
      return reply.status(201).send({ success: true, data: speaker });
    },
  );

  // ─── List Event Speakers ──────────────────────────────────────────────
  fastify.get(
    "/:eventId/speakers",
    {
      preHandler: [validate({ params: ParamsWithEventId, query: SpeakerQuerySchema })],
      schema: {
        tags: ["Speakers"],
        summary: "List speakers for an event (public)",
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { page, limit } = request.query as z.infer<typeof SpeakerQuerySchema>;
      const result = await speakerService.listEventSpeakers(eventId, { page: page ?? 1, limit: limit ?? 50 });
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Get Speaker Detail ───────────────────────────────────────────────
  fastify.get(
    "/speakers/:speakerId",
    {
      preHandler: [validate({ params: ParamsWithSpeakerId })],
      schema: {
        tags: ["Speakers"],
        summary: "Get speaker detail (public)",
      },
    },
    async (request, reply) => {
      const { speakerId } = request.params as z.infer<typeof ParamsWithSpeakerId>;
      const speaker = await speakerService.getSpeaker(speakerId);
      return reply.send({ success: true, data: speaker });
    },
  );

  // ─── Update Speaker ───────────────────────────────────────────────────
  fastify.put(
    "/speakers/:speakerId",
    {
      preHandler: [
        authenticate,
        validate({ params: ParamsWithSpeakerId, body: UpdateSpeakerSchema }),
      ],
      schema: {
        tags: ["Speakers"],
        summary: "Update speaker profile",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { speakerId } = request.params as z.infer<typeof ParamsWithSpeakerId>;
      const dto = request.body as z.infer<typeof UpdateSpeakerSchema>;
      const speaker = await speakerService.updateSpeaker(speakerId, dto, request.user!);
      return reply.send({ success: true, data: speaker });
    },
  );

  // ─── Delete Speaker ───────────────────────────────────────────────────
  fastify.delete(
    "/speakers/:speakerId",
    {
      preHandler: [
        authenticate,
        requirePermission("event:manage_speakers"),
        validate({ params: ParamsWithSpeakerId }),
      ],
      schema: {
        tags: ["Speakers"],
        summary: "Remove speaker from event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { speakerId } = request.params as z.infer<typeof ParamsWithSpeakerId>;
      await speakerService.deleteSpeaker(speakerId, request.user!);
      return reply.send({ success: true });
    },
  );

  // ─── My Speaker Profile ───────────────────────────────────────────────
  fastify.get(
    "/:eventId/speakers/me",
    {
      preHandler: [
        authenticate,
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Speakers"],
        summary: "Get my speaker profile for an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const profile = await speakerService.getMySpeakerProfile(eventId, request.user!);
      return reply.send({ success: true, data: profile });
    },
  );
};
