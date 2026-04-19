import type { FastifyInstance } from "fastify";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { sessionService } from "@/services/session.service";
import {
  CreateSessionSchema,
  UpdateSessionSchema,
  SessionScheduleQuerySchema,
} from "@teranga/shared-types";
import { z } from "zod";

const EventIdParams = z.object({ eventId: z.string() });
const SessionIdParams = z.object({ eventId: z.string(), sessionId: z.string() });

export async function sessionRoutes(app: FastifyInstance) {
  // ─── List sessions for an event ─────────────────────────────────────────
  // Published schedules are readable by any authenticated user; the service
  // re-gates non-published events behind org access.
  app.get(
    "/:eventId/sessions",
    {
      preHandler: [
        authenticate,
        validate({ params: EventIdParams, query: SessionScheduleQuerySchema }),
      ],
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof EventIdParams>;
      const query = request.query as z.infer<typeof SessionScheduleQuerySchema>;
      const result = await sessionService.listByEvent(eventId, query, request.user!);
      return reply.send({ success: true, ...result });
    },
  );

  // ─── Get single session ─────────────────────────────────────────────────
  app.get(
    "/:eventId/sessions/:sessionId",
    {
      preHandler: [
        authenticate,
        validate({ params: SessionIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      const session = await sessionService.getById(eventId, sessionId, request.user!);
      return reply.send({ success: true, data: session });
    },
  );

  // ─── Create session ─────────────────────────────────────────────────────
  app.post(
    "/:eventId/sessions",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:create"),
        validate({ params: EventIdParams, body: CreateSessionSchema }),
      ],
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof EventIdParams>;
      const dto = request.body as z.infer<typeof CreateSessionSchema>;
      const session = await sessionService.create(eventId, dto, request.user!);
      return reply.status(201).send({ success: true, data: session });
    },
  );

  // ─── Update session ─────────────────────────────────────────────────────
  app.patch(
    "/:eventId/sessions/:sessionId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: SessionIdParams, body: UpdateSessionSchema }),
      ],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      const dto = request.body as z.infer<typeof UpdateSessionSchema>;
      await sessionService.update(eventId, sessionId, dto, request.user!);
      return reply.send({ success: true });
    },
  );

  // ─── Delete session ─────────────────────────────────────────────────────
  app.delete(
    "/:eventId/sessions/:sessionId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: SessionIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      await sessionService.delete(eventId, sessionId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── Bookmark a session ─────────────────────────────────────────────────
  app.post(
    "/:eventId/sessions/:sessionId/bookmark",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:read"),
        validate({ params: SessionIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      const bookmark = await sessionService.bookmark(eventId, sessionId, request.user!);
      return reply.status(201).send({ success: true, data: bookmark });
    },
  );

  // ─── Remove bookmark ───────────────────────────────────────────────────
  app.delete(
    "/:eventId/sessions/:sessionId/bookmark",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:read"),
        validate({ params: SessionIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      await sessionService.removeBookmark(eventId, sessionId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── Get user's bookmarks for an event ──────────────────────────────────
  app.get(
    "/:eventId/sessions-bookmarks",
    {
      preHandler: [
        authenticate,
        requirePermission("event:read"),
        validate({ params: EventIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof EventIdParams>;
      const bookmarks = await sessionService.getUserBookmarks(eventId, request.user!);
      return reply.send({ success: true, data: bookmarks });
    },
  );
}
