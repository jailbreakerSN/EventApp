import type { FastifyInstance } from "fastify";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { messagingService } from "@/services/messaging.service";
import {
  CreateConversationSchema,
  SendMessageSchema,
  MessageQuerySchema,
} from "@teranga/shared-types";
import { z } from "zod";

const ConversationIdParams = z.object({ conversationId: z.string() });

// W10-P2 / S3 — messaging mutation rate limit. 30 sends per minute is
// generous for live event chat (a participant DM-ing the organiser
// during a session) and bounds spammers below the rate where moderators
// could inspect every conversation. Applies to send + create-conv +
// mark-read uniformly.
const MESSAGING_MUTATION_RATE_LIMIT = { max: 30, timeWindow: "1 minute" } as const;

export async function messagingRoutes(app: FastifyInstance) {
  // ─── Create or get conversation ─────────────────────────────────────────
  app.post(
    "/",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("messaging:send"),
        validate({ body: CreateConversationSchema }),
      ],
      config: { rateLimit: MESSAGING_MUTATION_RATE_LIMIT },
    },
    async (request, reply) => {
      const dto = request.body as z.infer<typeof CreateConversationSchema>;
      const conversation = await messagingService.getOrCreateConversation(dto, request.user!);
      return reply.status(201).send({ success: true, data: conversation });
    },
  );

  // ─── List user's conversations ──────────────────────────────────────────
  app.get(
    "/",
    {
      preHandler: [
        authenticate,
        requirePermission("messaging:read_own"),
        validate({ query: MessageQuerySchema }),
      ],
    },
    async (request, reply) => {
      const query = request.query as z.infer<typeof MessageQuerySchema>;
      const result = await messagingService.listConversations(query, request.user!);
      return reply.send({ success: true, ...result });
    },
  );

  // ─── Send message ──────────────────────────────────────────────────────
  app.post(
    "/:conversationId/messages",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("messaging:send"),
        validate({ params: ConversationIdParams, body: SendMessageSchema }),
      ],
      config: { rateLimit: MESSAGING_MUTATION_RATE_LIMIT },
    },
    async (request, reply) => {
      const { conversationId } = request.params as z.infer<typeof ConversationIdParams>;
      const dto = request.body as z.infer<typeof SendMessageSchema>;
      const message = await messagingService.sendMessage(conversationId, dto, request.user!);
      return reply.status(201).send({ success: true, data: message });
    },
  );

  // ─── List messages in conversation ──────────────────────────────────────
  app.get(
    "/:conversationId/messages",
    {
      preHandler: [
        authenticate,
        requirePermission("messaging:read_own"),
        validate({ params: ConversationIdParams, query: MessageQuerySchema }),
      ],
    },
    async (request, reply) => {
      const { conversationId } = request.params as z.infer<typeof ConversationIdParams>;
      const query = request.query as z.infer<typeof MessageQuerySchema>;
      const result = await messagingService.listMessages(conversationId, query, request.user!);
      return reply.send({ success: true, ...result });
    },
  );

  // ─── Mark conversation as read ──────────────────────────────────────────
  app.post(
    "/:conversationId/read",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("messaging:read_own"),
        validate({ params: ConversationIdParams }),
      ],
      config: { rateLimit: MESSAGING_MUTATION_RATE_LIMIT },
    },
    async (request, reply) => {
      const { conversationId } = request.params as z.infer<typeof ConversationIdParams>;
      await messagingService.markAsRead(conversationId, request.user!);
      return reply.send({ success: true });
    },
  );
}
