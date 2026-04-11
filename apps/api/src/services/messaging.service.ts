import {
  type Conversation,
  type Message,
  type CreateConversationDto,
  type SendMessageDto,
  type MessageQuery,
} from "@teranga/shared-types";
import { conversationRepository, messageRepository } from "@/repositories/messaging.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";
import { ForbiddenError } from "@/errors/app-error";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { type PaginatedResult } from "@/repositories/base.repository";
import { db, COLLECTIONS } from "@/config/firebase";
import { registrationRepository } from "@/repositories/registration.repository";

export class MessagingService extends BaseService {
  // ─── Create or get conversation ───────────────────────────────────────────

  async getOrCreateConversation(dto: CreateConversationDto, user: AuthUser): Promise<Conversation> {
    this.requirePermission(user, "messaging:send");

    // Check for existing conversation
    const existing = await conversationRepository.findByParticipants(user.uid, dto.participantId);
    if (existing) return existing;

    // IDOR fix: verify both users share at least one common event registration
    // This prevents cross-org messaging between strangers
    const [senderRegs, recipientRegs] = await Promise.all([
      registrationRepository.findByUser(user.uid, { page: 1, limit: 1000 }),
      registrationRepository.findByUser(dto.participantId, { page: 1, limit: 1000 }),
    ]);

    const senderEventIds = new Set(senderRegs.data.map((r) => r.eventId));
    const hasCommonEvent = recipientRegs.data.some((r) => senderEventIds.has(r.eventId));

    if (!hasCommonEvent) {
      throw new ForbiddenError(
        "Vous ne pouvez envoyer un message qu'aux participants partageant un événement commun",
      );
    }

    const conversation = await conversationRepository.create({
      participantIds: [user.uid, dto.participantId].sort(), // sorted for consistency
      eventId: dto.eventId ?? null,
      lastMessage: null,
      lastMessageAt: null,
      unreadCounts: {},
    });

    return conversation;
  }

  // ─── List user's conversations ────────────────────────────────────────────

  async listConversations(
    query: MessageQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<Conversation>> {
    this.requirePermission(user, "messaging:read_own");

    return conversationRepository.findByUser(user.uid, {
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    });
  }

  // ─── Send message ─────────────────────────────────────────────────────────

  async sendMessage(conversationId: string, dto: SendMessageDto, user: AuthUser): Promise<Message> {
    this.requirePermission(user, "messaging:send");

    const conversation = await conversationRepository.findByIdOrThrow(conversationId);

    // Only participants can send messages
    if (!conversation.participantIds.includes(user.uid)) {
      throw new ForbiddenError("Vous n'êtes pas participant(e) de cette conversation");
    }

    const message = await messageRepository.create({
      conversationId,
      senderId: user.uid,
      content: dto.content,
      type: dto.type ?? "text",
      mediaURL: dto.mediaURL ?? null,
      isRead: false,
      readAt: null,
      deletedAt: null,
    });

    // Update conversation metadata
    const otherUserId = conversation.participantIds.find((id) => id !== user.uid) ?? "";
    const unreadCounts = { ...conversation.unreadCounts };
    unreadCounts[otherUserId] = (unreadCounts[otherUserId] ?? 0) + 1;

    await conversationRepository.update(conversationId, {
      lastMessage: dto.content.slice(0, 100),
      lastMessageAt: message.createdAt,
      unreadCounts,
    });

    eventBus.emit("message.sent", {
      messageId: message.id,
      conversationId,
      senderId: user.uid,
      recipientId: otherUserId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return message;
  }

  // ─── List messages in conversation ────────────────────────────────────────

  async listMessages(
    conversationId: string,
    query: MessageQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<Message>> {
    this.requirePermission(user, "messaging:read_own");

    const conversation = await conversationRepository.findByIdOrThrow(conversationId);

    if (!conversation.participantIds.includes(user.uid)) {
      throw new ForbiddenError("Vous n'êtes pas participant(e) de cette conversation");
    }

    return messageRepository.findByConversation(conversationId, {
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    });
  }

  // ─── Mark conversation as read ────────────────────────────────────────────

  async markAsRead(conversationId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "messaging:read_own");

    const conversation = await conversationRepository.findByIdOrThrow(conversationId);

    if (!conversation.participantIds.includes(user.uid)) {
      throw new ForbiddenError("Vous n'êtes pas participant(e) de cette conversation");
    }

    const unreadCounts = { ...conversation.unreadCounts };
    unreadCounts[user.uid] = 0;

    await conversationRepository.update(conversationId, { unreadCounts });

    // Mark individual messages as read
    const unreadMessages = await messageRepository.findMany(
      [
        { field: "conversationId", op: "==", value: conversationId },
        { field: "isRead", op: "==", value: false },
        { field: "senderId", op: "!=", value: user.uid },
      ],
      { page: 1, limit: 500, orderBy: "createdAt", orderDir: "asc" },
    );

    const batch = db.batch();
    const now = new Date().toISOString();
    for (const msg of unreadMessages.data) {
      batch.update(db.collection(COLLECTIONS.MESSAGES).doc(msg.id), {
        isRead: true,
        readAt: now,
        updatedAt: now,
      });
    }
    if (unreadMessages.data.length > 0) {
      await batch.commit();
    }
  }
}

export const messagingService = new MessagingService();
