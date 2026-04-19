import { z } from "zod";

// ─── Audit Log Entry ─────────────────────────────────────────────────────────
// Structured audit record for security-sensitive operations.
// Written by the API's domain event listeners; read by super admins.

export const AuditActionSchema = z.enum([
  "registration.created",
  "registration.cancelled",
  "registration.approved",
  "checkin.completed",
  "event.created",
  "event.updated",
  "event.published",
  "event.unpublished",
  "event.cancelled",
  "event.archived",
  "organization.created",
  "member.added",
  "member.removed",
  "badge.generated",
  "waitlist.promoted",
  "waitlist.promotion_failed",
  "ticket_type.added",
  "ticket_type.updated",
  "ticket_type.removed",
  "event.cloned",
  "invite.created",
  "invite.accepted",
  "invite.declined",
  "invite.revoked",
  "member.role_changed",
  "member.role_updated",
  "organization.updated",
  "session.created",
  "session.updated",
  "session.deleted",
  "feed_post.created",
  "feed_post.deleted",
  "feed_post.pinned",
  "message.sent",
  "broadcast.sent",
  "payout.created",
  "payment.initiated",
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
  "receipt.generated",
  // ── Speaker & Sponsor ──────────────────────────────────────────────────────
  "speaker.added",
  "speaker.removed",
  "sponsor.added",
  "sponsor.removed",
  "sponsor.lead_captured",
  // ── Venue ─────────────────────────────────────────────────────────────────
  "venue.created",
  "venue.updated",
  "venue.approved",
  "venue.suspended",
  "venue.reactivated",
  // ── Admin ─────────────────────────────────────────────────────────────────
  "user.role_changed",
  "user.suspended",
  "user.activated",
  "organization.verified",
  "organization.suspended",
  // ── Plan Catalog ──────────────────────────────────────────────────────────
  "plan.created",
  "plan.updated",
  "plan.archived",
  // ── Subscription lifecycle (Phase 4c) ─────────────────────────────────────
  "subscription.upgraded",
  "subscription.downgraded",
  "subscription.change_scheduled",
  "subscription.scheduled_reverted",
  "subscription.period_rolled_over",
  // ── Subscription override (Phase 5 — admin per-org assign) ────────────────
  "subscription.overridden",
]);

export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  action: AuditActionSchema,
  actorId: z.string(),
  requestId: z.string(),
  timestamp: z.string().datetime(),
  resourceType: z.string(),
  resourceId: z.string(),
  eventId: z.string().nullable(),
  organizationId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// ─── Registration Request Schemas ────────────────────────────────────────────
// Used for API route validation on registration endpoints.

export const CreateRegistrationSchema = z.object({
  eventId: z.string(),
  ticketTypeId: z.string(),
});

export type CreateRegistrationDto = z.infer<typeof CreateRegistrationSchema>;

export const CheckInSchema = z.object({
  qrCodeValue: z.string(),
  accessZoneId: z.string().optional(),
});

export type CheckInDto = z.infer<typeof CheckInSchema>;

export const ApproveRegistrationParamsSchema = z.object({
  registrationId: z.string(),
});
