import { type Conversation, type Message } from "@teranga/shared-types";
import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "./base.repository";

class ConversationRepository extends BaseRepository<Conversation> {
  constructor() {
    super(COLLECTIONS.CONVERSATIONS, "Conversation");
  }

  async findByUser(
    userId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Conversation>> {
    return this.findMany(
      [{ field: "participantIds", op: "array-contains", value: userId }],
      { ...pagination, orderBy: "lastMessageAt", orderDir: "desc" },
    );
  }

  async findByParticipants(
    userId1: string,
    userId2: string,
  ): Promise<Conversation | null> {
    // Look for existing conversation between these two users
    const result = await this.findMany(
      [{ field: "participantIds", op: "array-contains", value: userId1 }],
      { page: 1, limit: 100, orderBy: "createdAt", orderDir: "desc" },
    );
    return result.data.find((c) => c.participantIds.includes(userId2)) ?? null;
  }
}

class MessageRepository extends BaseRepository<Message> {
  constructor() {
    super(COLLECTIONS.MESSAGES, "Message");
  }

  async findByConversation(
    conversationId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Message>> {
    return this.findMany(
      [
        { field: "conversationId", op: "==", value: conversationId },
        { field: "deletedAt", op: "==", value: null },
      ],
      { ...pagination, orderBy: "createdAt", orderDir: "desc" },
    );
  }
}

export const conversationRepository = new ConversationRepository();
export const messageRepository = new MessageRepository();
