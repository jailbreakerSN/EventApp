import { z } from "zod";

// ─── Communication Channel ──────────────────────────────────────────────────

export const CommunicationChannelSchema = z.enum(["sms", "email", "push", "in_app"]);

export type CommunicationChannel = z.infer<typeof CommunicationChannelSchema>;

// ─── Email Category ─────────────────────────────────────────────────────────
// Categorizes outbound email by purpose so the API can route each send to
// the correct From/Reply-To pair (see apps/api/src/services/email/sender.registry.ts).
// Keeping categories narrow protects domain reputation: fewer, purposeful
// senders are easier to monitor in Resend and easier for users to trust.
//
// - auth           Account & security (verification, password reset, login alert)
// - transactional  User-triggered event lifecycle (registration, badge, reminder, cancellation)
// - organizational Org/member lifecycle (invite, role change, plan limit warning)
// - billing        Money (invoice, payment receipt, subscription change)
// - marketing      Opt-in bulk (newsletter, product announcements)

export const EmailCategorySchema = z.enum([
  "auth",
  "transactional",
  "organizational",
  "billing",
  "marketing",
]);

export type EmailCategory = z.infer<typeof EmailCategorySchema>;

// ─── Broadcast ──────────────────────────────────────────────────────────────

export const BroadcastStatusSchema = z.enum(["draft", "scheduled", "sending", "sent", "failed"]);

export type BroadcastStatus = z.infer<typeof BroadcastStatusSchema>;

export const BroadcastRecipientFilterSchema = z.enum(["all", "checked_in", "not_checked_in"]);

export type BroadcastRecipientFilter = z.infer<typeof BroadcastRecipientFilterSchema>;

export const BroadcastSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  organizationId: z.string(),
  title: z.string().max(200),
  body: z.string().max(2000),
  channels: z.array(CommunicationChannelSchema).min(1),
  recipientFilter: BroadcastRecipientFilterSchema,
  recipientCount: z.number().int().default(0),
  sentCount: z.number().int().default(0),
  failedCount: z.number().int().default(0),
  status: BroadcastStatusSchema,
  scheduledAt: z.string().datetime().nullable().optional(),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
});

export type Broadcast = z.infer<typeof BroadcastSchema>;

export const CreateBroadcastSchema = z.object({
  eventId: z.string(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  channels: z.array(CommunicationChannelSchema).min(1),
  recipientFilter: BroadcastRecipientFilterSchema.default("all"),
  scheduledAt: z.string().datetime().optional(),
});

export type CreateBroadcastDto = z.infer<typeof CreateBroadcastSchema>;

export const BroadcastQuerySchema = z.object({
  status: BroadcastStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type BroadcastQuery = z.infer<typeof BroadcastQuerySchema>;

// ─── Notification Preferences ───────────────────────────────────────────────

export const NotificationPreferenceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.boolean().default(true),
  sms: z.boolean().default(true),
  push: z.boolean().default(true),
  eventReminders: z.boolean().default(true),
  quietHoursStart: z.string().nullable(), // "22:00"
  quietHoursEnd: z.string().nullable(), // "08:00"
  updatedAt: z.string().datetime(),
});

export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

export const UpdateNotificationPreferenceSchema = z.object({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  push: z.boolean().optional(),
  eventReminders: z.boolean().optional(),
  quietHoursStart: z.string().nullable().optional(),
  quietHoursEnd: z.string().nullable().optional(),
});

export type UpdateNotificationPreferenceDto = z.infer<typeof UpdateNotificationPreferenceSchema>;
