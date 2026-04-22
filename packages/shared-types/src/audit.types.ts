import { z } from "zod";

// ─── Audit Log Entry ─────────────────────────────────────────────────────────
// Structured audit record for security-sensitive operations.
// Written by the API's domain event listeners; read by super admins.

export const AuditActionSchema = z.enum([
  "registration.created",
  "registration.cancelled",
  "registration.approved",
  "checkin.completed",
  "checkin.bulk_synced",
  "checkin.offline_sync.downloaded",
  "event.created",
  "event.updated",
  "event.qr_key_rotated",
  "event.published",
  "event.unpublished",
  "event.cancelled",
  "event.archived",
  "organization.created",
  "member.added",
  "member.removed",
  "badge.generated",
  "badge.bulk_generated",
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
  // ── Newsletter ────────────────────────────────────────────────────────────
  "newsletter.subscriber_created",
  "newsletter.subscriber_confirmed",
  "newsletter.sent",
  // ── Notification preferences ──────────────────────────────────────────────
  "notification.unsubscribed",
  // Phase 2.5 — user flipped a per-key opt-out back to enabled from the
  // history page. Mirrors notification.unsubscribed for audit symmetry.
  "notification.resubscribed",
  // ── Notification system (dispatcher, super-admin settings) ───────────────
  // Emitted by the NotificationService dispatcher on every channel delivery,
  // every suppression decision (admin_disabled / user_opted_out / on_suppression_list
  // / bounced / no_recipient), and every super-admin write to notificationSettings.
  // See docs/notification-system-architecture.md §11 + §12.
  "notification.sent",
  "notification.suppressed",
  "notification.setting_updated",
  // Phase 2.2 — emitted when the dispatcher short-circuits a dup emit
  // using the persistent idempotency log. Distinct from "sent" so
  // dashboards don't conflate providers-delivered vs. caller-retried.
  "notification.deduplicated",
  // Phase 2.4 — admin "test send" from the notifications control plane.
  // Never conflated with real delivery — admin previews must not skew
  // stats or the dispatch log.
  "notification.test_sent",
  // Phase B.1 — distinct action string for self-triggered test sends
  // (POST /v1/notifications/test-send). Separated from the admin-triggered
  // `notification.test_sent` so audit queries can filter "who sent what to
  // whom" without ambiguity.
  "notification.test_sent_self",
  // ── FCM device-token registration (Phase C.1 — Web Push) ────────────────
  // Emitted by FcmTokensService on register / revoke / revoke-all so the
  // audit trail carries a record of which browser/device each user trusts
  // for push. Tokens themselves never land in the audit log — only their
  // sha256 fingerprint (first 16 hex chars).
  "fcm.token_registered",
  "fcm.token_revoked",
  "fcm.tokens_cleared",
  // ── Web Push back-annotations (Phase C.2) ───────────────────────────────
  // Emitted by the notifications routes when the service worker pings
  // /v1/notifications/:id/push-displayed (on showNotification) or
  // .../push-clicked (on notificationclick). Powers delivery-rate dashboards
  // and a future "which channel got through" attribution widget. Never
  // blocks the SW — the endpoints are best-effort, anonymous-probes welcome.
  "push.displayed",
  "push.clicked",
  // ── Resend webhook-sourced events (written from apps/functions) ───────────
  // Cloud Functions can't emit on the API's in-process eventBus, so the
  // resendWebhook handler writes these audit rows directly. Values kept in
  // lockstep with the action strings in apps/functions/src/triggers/resend/
  // resend-webhook.https.ts #writeAuditLog.
  "email.bounced",
  "email.complained",
  "email.resend_unsubscribed",
  "email.resend_contact_deleted",
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
