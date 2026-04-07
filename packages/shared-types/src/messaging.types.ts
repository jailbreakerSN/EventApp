import { z } from "zod";

// ─── Direct Messaging ─────────────────────────────────────────────────────────

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  content: z.string().min(1).max(4000),
  type: z.enum(["text", "image", "file"]).default("text"),
  mediaURL: z.string().url().nullable().optional(),
  isRead: z.boolean().default(false),
  readAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  participantIds: z.array(z.string()).length(2), // 1:1 only for now
  eventId: z.string().nullable().optional(),     // scoped to an event if set
  lastMessage: z.string().nullable().optional(),
  lastMessageAt: z.string().datetime().nullable().optional(),
  unreadCounts: z.record(z.string(), z.number()).default({}), // uid -> count
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

// ─── Event Feed / Activity ────────────────────────────────────────────────────

export const FeedPostSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  authorPhotoURL: z.string().url().nullable().optional(),
  authorRole: z.string(),
  content: z.string().min(1).max(2000),
  mediaURLs: z.array(z.string().url()).default([]),
  likeCount: z.number().int().default(0),
  commentCount: z.number().int().default(0),
  likedByIds: z.array(z.string()).default([]),
  isPinned: z.boolean().default(false),
  isAnnouncement: z.boolean().default(false), // from organizer
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type FeedPost = z.infer<typeof FeedPostSchema>;

export const FeedCommentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  content: z.string().min(1).max(1000),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type FeedComment = z.infer<typeof FeedCommentSchema>;

// ─── Feed DTOs ───────────────────────────────────────────────────────────────

export const CreateFeedPostSchema = z.object({
  content: z.string().min(1).max(2000),
  mediaURLs: z.array(z.string().url()).max(10).default([]),
  isAnnouncement: z.boolean().default(false),
});

export type CreateFeedPostDto = z.infer<typeof CreateFeedPostSchema>;

export const CreateFeedCommentSchema = z.object({
  content: z.string().min(1).max(1000),
});

export type CreateFeedCommentDto = z.infer<typeof CreateFeedCommentSchema>;

export const FeedQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export type FeedQuery = z.infer<typeof FeedQuerySchema>;

// ─── Messaging DTOs ──────────────────────────────────────────────────────────

export const CreateConversationSchema = z.object({
  participantId: z.string(),               // the other user
  eventId: z.string().nullable().optional(), // optionally scope to event
});

export type CreateConversationDto = z.infer<typeof CreateConversationSchema>;

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  type: z.enum(["text", "image", "file"]).default("text"),
  mediaURL: z.string().url().nullable().optional(),
});

export type SendMessageDto = z.infer<typeof SendMessageSchema>;

export const MessageQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type MessageQuery = z.infer<typeof MessageQuerySchema>;

// ─── Notifications ────────────────────────────────────────────────────────────

export const NotificationTypeSchema = z.enum([
  "event_published",
  "event_reminder",
  "event_cancelled",
  "event_updated",
  "registration_confirmed",
  "registration_approved",
  "check_in_success",
  "new_message",
  "new_announcement",
  "badge_ready",
  "system",
]);

export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.string()).optional(), // deep link data
  imageURL: z.string().url().nullable().optional(),
  isRead: z.boolean().default(false),
  readAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type Notification = z.infer<typeof NotificationSchema>;
