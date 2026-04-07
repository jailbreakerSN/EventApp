import type { FastifyInstance } from "fastify";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { messagingService } from "@/services/messaging.service";
import {
  CreateConversationSchema,
  SendMessageSchema,
  MessageQuerySchema,
} from "@teranga/shared-types";
import { z } from "zod";

const ConversationIdParams = z.object({ conversationId: z.string() });

export async function messagingRoutes(app: FastifyInstance) {
  // ─── Create or get conversation ─────────────────────────────────────────
  app.post(
    "/",
    {
      preHandler: [
        authenticate,
        validate({ body: CreateConversationSchema }),
      ],
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
        validate({ params: ConversationIdParams, body: SendMessageSchema }),
      ],
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
        validate({ params: ConversationIdParams }),
      ],
    },
    async (request, reply) => {
      const { conversationId } = request.params as z.infer<typeof ConversationIdParams>;
      await messagingService.markAsRead(conversationId, request.user!);
      return reply.send({ success: true });
    },
  );
}
