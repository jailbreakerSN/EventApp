import { z } from "zod";
import { NotificationPreferenceValueSchema } from "./notification-preferences.types";

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

  // Channel-level toggles (unchanged). `email` is a legacy aggregate — kept
  // for back-compat with docs created before 3c.3 and as a user-facing
  // kill-switch ("turn off ALL non-mandatory email at once"). The per-
  // category fields below take precedence: if both are set, `email` is
  // ignored. auth + billing are mandatory and ignore every flag here.
  email: z.boolean().default(true),
  sms: z.boolean().default(true),
  push: z.boolean().default(true),

  // Per-category email toggles (Phase 3c.3). Each maps to an EmailCategory
  // in the sender registry. Missing = default true; legacy docs without
  // these fields fall back to the `email` aggregate above.
  // `marketing` here is a secondary gate for future marketing sends that
  // don't go through the Resend Segment — the newsletter subscribe flow
  // is the primary opt-in/out mechanism for the Segment itself.
  emailTransactional: z.boolean().default(true),
  emailOrganizational: z.boolean().default(true),
  emailMarketing: z.boolean().default(true),

  // Cross-channel "send reminders at all" flag. Applies on top of the
  // channel + category gates — a user who wants email but no reminders
  // sets this false.
  eventReminders: z.boolean().default(true),
  quietHoursStart: z.string().nullable(), // "22:00"
  quietHoursEnd: z.string().nullable(), // "08:00"
  // Per-notification-key opt-out (Phase 3 + Phase 2.6 per-channel extension).
  //
  // Map of catalog key → preference value. Each value is EITHER a bare
  // boolean (legacy: applies to every channel — absent / true = follow
  // defaults, false = opt out of all channels) OR a per-channel object
  // (Phase 2.6) with optional { email, sms, push, in_app } booleans.
  //
  // Resolution is delegated to `isChannelAllowedForUser()` in
  // apps/api/src/services/notifications/channel-preferences.ts so legacy
  // docs written as `Record<string, boolean>` keep working byte-for-byte.
  //
  // Security + transactional notifications (userOptOutAllowed=false in
  // the catalog) bypass this map entirely — see
  // docs/notification-system-architecture.md §8.
  byKey: z.record(z.string(), NotificationPreferenceValueSchema).optional(),
  updatedAt: z.string().datetime(),
});

export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

export const UpdateNotificationPreferenceSchema = z.object({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  push: z.boolean().optional(),
  emailTransactional: z.boolean().optional(),
  emailOrganizational: z.boolean().optional(),
  emailMarketing: z.boolean().optional(),
  eventReminders: z.boolean().optional(),
  quietHoursStart: z.string().nullable().optional(),
  quietHoursEnd: z.string().nullable().optional(),
  // Accepts the per-channel shape OR the legacy bare-boolean map (Phase
  // 2.6). Frontend may mix the two in the same map for the same request —
  // the dispatcher resolves each value via isChannelAllowedForUser().
  byKey: z.record(z.string(), NotificationPreferenceValueSchema).optional(),
});

export type UpdateNotificationPreferenceDto = z.infer<typeof UpdateNotificationPreferenceSchema>;
