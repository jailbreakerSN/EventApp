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
  "event.restored",
  "event.series_cancelled",
  "scheduled_admin_op.created",
  "scheduled_admin_op.updated",
  "scheduled_admin_op.deleted",
  "organization.created",
  "member.added",
  "member.removed",
  "badge.generated",
  "badge.bulk_generated",
  "waitlist.promoted",
  "waitlist.promotion_failed",
  // B2 follow-up — aggregate row emitted by bulk-promote, alongside one
  // `waitlist.promoted` per successful entry. Lets ops dashboards
  // answer "which organisers ran bulk promotions, when, with what
  // tier scope" without aggregating per-entry events.
  "waitlist.bulk_promoted",
  "ticket_type.added",
  "ticket_type.updated",
  "ticket_type.removed",
  "event.cloned",
  // Recurring events (Phase 7+ item #B1)
  "event.series_created",
  "event.series_published",
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
  // Phase Finance — per-organization summary emitted by
  // `balanceService.releaseAvailableFunds` after one or more `pending`
  // ledger entries graduate to `available` (their `availableOn` window
  // has elapsed). One row per org per sweep, carrying count + signed
  // net amount + capped sample of released entry IDs. Both the cron
  // path (Cloud Function → internal route → service) and the admin
  // path (/admin/jobs → runner → handler → service) emit the same
  // event via the in-process eventBus; the audit listener writes the
  // row regardless of trigger.
  "balance_transaction.released",
  // Phase Finance — cron-tick heartbeat for the release sweep.
  // Emitted EXACTLY once per `releaseAvailableFunds` invocation
  // regardless of whether any entry was released — a healthy
  // `released: 0` tick proves the cron is alive vs. silently dead,
  // and ops dashboards can graph release cadence over time. Mirrors
  // `payment.reconciliation_swept`.
  "balance.release_swept",
  "payment.initiated",
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
  // Phase 2 follow-up — explicit expiration of a payment, either by
  // the auto-expirer cron (timeout > TTL) or by user-initiated cancel
  // of a pending_payment registration. Distinct from `payment.failed`
  // (provider rejection) so the audit grid can filter "expired" vs
  // "rejected" cleanly.
  "payment.expired",
  // ADR-0018 — verify-on-return path. Logs the OUTCOME observed when
  // the participant lands on /payment-status and we proactively call
  // provider.verify(). Distinct from `payment.succeeded` /
  // `payment.failed` (which still fire for the actual state flip)
  // because operators investigating a stuck-payment incident need to
  // see WHICH path finalised the Payment (IPN vs. user-triggered
  // verify) — useful for sizing the IPN-reliability incident.
  "payment.verified_from_redirect",
  // Phase 3 reconciliation cron (every 10 min) heartbeat — one row
  // per sweep with aggregate stats (scanned / succeeded / failed /
  // pending / errored). Lets ops dashboards graph the IPN-miss rate
  // over time without scanning per-payment events. See ADR-0018.
  "payment.reconciliation_swept",
  // Phase-1 audit follow-up — refund customer-notification + provider-
  // failure variants emit dedicated events for the dispatcher; the
  // audit trail logs them as distinct rows so post-incident analysis
  // can separate "we issued a refund and notified the customer" from
  // "we tried to refund and the provider rejected".
  "refund.issued",
  "refund.failed",
  // P1-21 — emitted per ≤ 400-row batch by the
  // `expire-stale-payments` admin job. Captures bulk Payment + linked
  // Registration mutations the operator dashboard timeline needs to
  // reflect outside the coarse `admin.job_completed` summary.
  "payment.bulk_expired",
  // Phase 2 / threat T-PD-03 — fires when handleWebhook rejects an
  // IPN whose anti-tampering invariants failed. The webhook signature
  // verified (so the request came from the provider), but the
  // payload's bound fields (payment_id / amount) didn't match the
  // Payment doc. Required for the security trail because the webhook
  // log row only marks `failed`, which isn't surfaced on the
  // standard `/admin/audit` grid.
  "payment.tampering_attempted",
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
  // Admin overhaul Phase 4 — impersonation audit actions.
  "user.impersonated",
  "user.impersonation_ended",
  // Admin overhaul Phase 6 / D — platform ops actions.
  "admin.feature_flag_updated",
  "admin.announcement_published",
  "user.suspended",
  "user.activated",
  "organization.verified",
  "organization.suspended",
  // Phase D.3 — super-admin queried the delivery-observability dashboard.
  // Queries scan the dispatch log over a 30-day window and surface
  // per-channel delivery funnels. Treated as audit-worthy because the
  // endpoint exposes cross-tenant recipient metadata (redacted) + a
  // cross-organizational view of notification traffic.
  "admin.delivery_dashboard_viewed",
  // ── Plan Catalog ──────────────────────────────────────────────────────────
  "plan.created",
  "plan.updated",
  "plan.archived",
  // ── Plan Coupons (Phase 7+ item #7) ───────────────────────────────────────
  // Super-admin CRUD on the promo-campaign primitive. Redemptions are
  // captured separately on the subscription + couponRedemptions doc, so
  // there's no `plan_coupon.redeemed` action here — the redemption event
  // is the subscription.upgraded with appliedCoupon set.
  "plan_coupon.created",
  "plan_coupon.updated",
  "plan_coupon.archived",
  // ── Subscription lifecycle (Phase 4c) ─────────────────────────────────────
  "subscription.upgraded",
  "subscription.downgraded",
  "subscription.cancelled",
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
  // ── API keys (T2.3) ───────────────────────────────────────────────────
  // Issued / revoked / rotated by organization admins via
  // /v1/organizations/:orgId/api-keys. actorId = the user who clicked,
  // resourceType = "api_key", resourceId = the key's hashPrefix (doc id).
  // Details never carry plaintext — only the non-secret metadata
  // (scopes, environment, name, revocation reason).
  "api_key.created",
  "api_key.revoked",
  "api_key.rotated",
  // T2.3 (remediation) — emitted by the auth middleware on successful
  // verification, throttled to at most one entry per key per hour per
  // IP (see ApiKeysService.verify()). Audits the "key was used from X"
  // signal so SOC alerting can fire on "key used from an IP never
  // seen before". Details carry `hashPrefix` + redacted IP + UA
  // hash, never the plaintext key.
  "api_key.verified",
  // Phase O6 — WhatsApp opt-in lifecycle. Each opt-in / revoke writes
  // one audit row with the consent metadata (phoneE164, organizationId)
  // for legal traceability of Meta-required consent.
  "whatsapp.opt_in.granted",
  "whatsapp.opt_in.revoked",
  // Phase O6 — delivery webhook from Meta. We log only `failed` to
  // keep the audit log readable; sent/delivered/read updates land in
  // structured logs but not the audit collection.
  "whatsapp.delivery.failed",
  // Phase O7 — participant ops (tags / notes / merge). Tag mutations
  // and notes edits go through profile.updated; merge produces a
  // dedicated event because the side-effect is much larger
  // (registrations re-pointed, secondary archived).
  "participant_profile.updated",
  "participant.merged",
  // Phase O8 — Live Event Mode (Floor Ops).
  "incident.created",
  "incident.updated",
  "incident.resolved",
  "emergency_broadcast.sent",
  "staff_message.posted",
  // Phase O9 — Post-event Report + Reconciliation.
  // `cohort_export` covers both PDF + CSV downloads since both
  // surface the same scrubbed cohort and exfiltrate participant data.
  "post_event_report.generated",
  "cohort_export.downloaded",
  "payout.requested",
  // Phase O10 — Event templates + magic links.
  "event.cloned_from_template",
  "magic_link.issued",
  "magic_link.revoked",
  "magic_link.used",
]);

export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  action: AuditActionSchema,
  actorId: z.string(),
  /**
   * Denormalized human-readable label for the acting user, set at
   * write-time by `auditService.log()` by looking up the user's
   * `displayName ?? email` from Firestore (5-minute in-memory cache
   * inside the API). Null for system actors (cron jobs, triggers) or
   * when the lookup fails — readers MUST fall back to `actorId`.
   *
   * Added in Tier-1.1 of the admin overhaul follow-up. Historical
   * rows predating this field will render with the actorId fallback;
   * backfilling them is tracked as a separate follow-up.
   */
  actorDisplayName: z.string().nullable().optional(),
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
