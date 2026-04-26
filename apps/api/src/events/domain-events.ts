import { type Registration, type Event, type Organization } from "@teranga/shared-types";

// ─── Domain Event Payloads ───────────────────────────────────────────────────
// Each payload includes the entity data plus actor/request context
// so listeners can log, notify, and audit without re-fetching.

export interface BaseEventPayload {
  actorId: string;
  requestId: string;
  timestamp: string;
}

// ── Registration ─────────────────────────────────────────────────────────────

export interface RegistrationCreatedEvent extends BaseEventPayload {
  registration: Registration;
  eventId: string;
  organizationId: string;
}

export interface RegistrationCancelledEvent extends BaseEventPayload {
  registrationId: string;
  eventId: string;
  userId: string;
  organizationId: string;
}

export interface RegistrationApprovedEvent extends BaseEventPayload {
  registrationId: string;
  eventId: string;
  userId: string;
  organizationId: string;
}

// ── Check-in ─────────────────────────────────────────────────────────────────

export interface CheckInCompletedEvent extends BaseEventPayload {
  registrationId: string;
  eventId: string;
  // Organization owning the event. Carried on the event payload so the
  // audit listener can stamp `auditLogs.organizationId` without a
  // second Firestore read — cross-org audit queries otherwise hit a
  // null column (security-review follow-up).
  organizationId: string;
  participantId: string;
  staffId: string;
  accessZoneId?: string | null;
  checkedInAt?: string;
  source?: "live" | "offline_sync";
  // Device attestation — WHICH physical scanner accepted the QR. Paired
  // with `scannerNonce`, this feeds the future security dashboard's
  // velocity check (same QR, different device within N minutes ⇒
  // screenshot-share signal). Both optional because older app builds
  // don't send them; listeners treat missing fields as "unattested".
  scannerDeviceId?: string | null;
  scannerNonce?: string | null;
  // Client-reported scan time, carried separately from the server's
  // `checkedInAt` because offline reconciliation can land much later
  // than the actual scan. Forensics needs both.
  clientScannedAt?: string | null;
}

export interface BulkCheckinSyncedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Fires every time a staff device pulls the offline sync bundle. Because the
 * payload contains every confirmed registration's signed QR, we need a
 * per-download forensic trail — if a device later leaks badges we can
 * correlate by `staffId`, `scannerDeviceId`, and event. `encrypted` reports
 * whether the client requested the ECDH envelope; once the Flutter scanner
 * opts in this should be `true` in steady state.
 */
export interface OfflineSyncDownloadedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  staffId: string;
  scannerDeviceId?: string | null;
  encrypted: boolean;
  /** Registration count shipped in the payload — useful for anomaly alerts. */
  itemCount: number;
  /** Client-side cache TTL — the `event.endDate + 24h` we returned. */
  ttlAt: string;
}

// ── Access Zone ─────────────────────────────────────────────────────────────

export interface AccessZoneAddedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  zoneId: string;
  zoneName: string;
}

export interface AccessZoneUpdatedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  zoneId: string;
  changes: Record<string, unknown>;
}

export interface AccessZoneRemovedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  zoneId: string;
  zoneName: string;
}

// ── Event ────────────────────────────────────────────────────────────────────

export interface EventCreatedEvent extends BaseEventPayload {
  event: Event;
  organizationId: string;
}

export interface EventUpdatedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  changes: Record<string, unknown>;
}

/**
 * Fires when an organizer edits the date, time, or location of a
 * published event. Distinct from the generic `event.updated` (which
 * covers any PATCH) so the notification dispatcher can route to the
 * `event.rescheduled` template without re-inspecting the diff, and so
 * audit queries can ask "who rescheduled this event, when" without a
 * join. Carries the before/after pair for each changed field — the
 * template renders both in the email.
 */
export interface EventRescheduledEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  previousStartDate: string;
  newStartDate: string;
  previousEndDate?: string;
  newEndDate?: string;
  previousLocation?: string;
  newLocation?: string;
  /** Optional free-text reason the organizer supplied. Never rendered verbatim. */
  reason?: string;
}

/**
 * Fires when an organizer rotates the event's QR signing key id. Distinct
 * from `event.updated` so the audit trail can tell "rotated the HMAC key"
 * apart from "edited the event description" — both matter for different
 * reasons at post-event forensics. `previousKid` carries the value that
 * was just retired (→ `qrKidHistory`); null only on the very first
 * rotation of an event that somehow predates the create-time kid mint.
 */
export interface EventQrKeyRotatedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  newKid: string;
  previousKid: string | null;
}

export interface EventPublishedEvent extends BaseEventPayload {
  event: Event;
  organizationId: string;
}

export interface EventCancelledEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
}

export interface EventUnpublishedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
}

export interface EventArchivedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
}

/**
 * T2.2 closure — emitted when an admin uses the "Restaurer" flow to
 * undo a recent archive (within the 30-day window). The actor is
 * the admin, not the original organizer.
 */
export interface EventRestoredEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
}

export interface EventClonedEvent extends BaseEventPayload {
  sourceEventId: string;
  newEventId: string;
  organizationId: string;
}

/**
 * Phase 7+ item #B1 — emitted by `EventService.createSeries()` after the
 * parent + child docs commit. Distinct from `event.created` (which is
 * also emitted for the parent for dashboard parity) so audit queries
 * can tell "created a recurring series of N" apart from "created a
 * single event". `occurrenceCount` is the CHILD count — the parent is
 * the anchor and doesn't count toward the series size.
 */
export interface EventSeriesCreatedEvent extends BaseEventPayload {
  parentEventId: string;
  organizationId: string;
  occurrenceCount: number;
}

/**
 * Phase 7+ item #B1 — emitted by `EventService.publishSeries()` after
 * parent + all children flip to `status: "published"`. `publishedCount`
 * is the number of CHILDREN that were flipped (parent + children all
 * transitioned together in one tx; parent is not counted here).
 */
export interface EventSeriesPublishedEvent extends BaseEventPayload {
  parentEventId: string;
  organizationId: string;
  publishedCount: number;
}

/**
 * Sprint-4 T3.2 — emitted on scheduled-op CRUD lifecycle.
 */
export interface ScheduledAdminOpCreatedEvent extends BaseEventPayload {
  opId: string;
  jobKey: string;
  cron: string;
}

export interface ScheduledAdminOpUpdatedEvent extends BaseEventPayload {
  opId: string;
  changes: string[];
}

export interface ScheduledAdminOpDeletedEvent extends BaseEventPayload {
  opId: string;
}

/**
 * Sprint-2 S1 closure — emitted when an admin/organizer cancels an
 * entire recurring-event series in one operation. The parent + every
 * non-already-cancelled child are flipped to `cancelled` atomically.
 * Listeners that need per-child fan-out (refunds, notifications)
 * read the included id list rather than re-querying.
 */
export interface EventSeriesCancelledEvent extends BaseEventPayload {
  parentEventId: string;
  organizationId: string;
  cancelledCount: number;
  cancelledChildIds: string[];
}

export interface WaitlistPromotedEvent extends BaseEventPayload {
  registrationId: string;
  eventId: string;
  userId: string;
  organizationId: string;
  /**
   * B2 follow-up F2 — set to `true` on per-entry events emitted from
   * `bulkPromoteWaitlisted` so dashboard queries can filter them out
   * when counting against the aggregate `waitlist.bulk_promoted` row
   * (avoids double-counting). Absent / `false` ⇒ single-cancel path.
   * Notifications still fire via the per-entry events regardless of
   * source — the discriminator is purely an audit / analytics signal.
   */
  bulkPromotion?: boolean;
}

/**
 * Aggregate event emitted by `RegistrationService.bulkPromoteWaitlisted`
 * after every per-entry transaction has run. Pairs with the per-entry
 * `waitlist.promoted` events: the per-entry events drive notification
 * dispatch (one email per promoted user), this aggregate gives operators
 * a single audit row + dashboard signal answering "who ran a bulk
 * promotion, when, with what tier scope, and what was the outcome".
 *
 * Precedent: `checkin.bulk_synced`, `event.series_created`,
 * `badge.bulk_generated` — same pattern (per-entry events for delivery,
 * one aggregate event for the audit trail summary).
 */
export interface WaitlistBulkPromotedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  /** How many waitlisted entries were promoted to confirmed. */
  promotedCount: number;
  /**
   * How many candidates were skipped. Skip can be a race-loss (already
   * promoted by a concurrent path), an exception inside the per-entry
   * transaction, or a candidate that was already cancelled when the
   * tx re-read it. The matching `waitlist.promotion_failed` events
   * carry per-entry detail; this number is the operator-facing total.
   */
  skipped: number;
  /** Optional ticket-type scope the batch ran against. Absent ⇒ global FIFO. */
  ticketTypeId?: string;
}

/**
 * Emitted when a waitlist-promotion attempt fails AFTER a successful
 * cancel. The cancel itself committed, but the event now has a
 * reserved-but-unfilled slot and a waitlisted user who should have
 * been promoted. Operators need visibility so they can investigate
 * (firestore transient? stuck registration? bug?) and either retry
 * manually or compensate.
 */
export interface WaitlistPromotionFailedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  /**
   * The registration whose cancel triggered the promotion attempt.
   * Optional because the retry-exhaustion failure path (B2 follow-up
   * F2) has no specific cancelled registration to attribute the
   * failure to — surfacing a synthetic doc-id string poisons any
   * future query that joins this field back to `registrations`.
   */
  cancelledRegistrationId?: string;
  /**
   * B2 — the ticket-type slice the failed promotion was scoped to. Cancel-
   * driven promotions are tier-aware (a freed VIP slot promotes a VIP
   * waitlister, not a Standard one), so when a tier-scoped promotion
   * fails the audit row needs the tier to answer "which tier's slot
   * is stuck". Optional because bulk-promote failures may not have a
   * specific tier (when the admin called bulk-promote without a
   * `ticketTypeId` filter).
   */
  ticketTypeId?: string;
  /**
   * B2 follow-up F2 — discriminator so the audit listener + dashboard
   * queries can tell the cancel-driven path apart from
   * retry-exhaustion (no specific cancelled reg) and bulk-entry
   * (per-candidate exception inside `bulkPromoteWaitlisted`).
   * Optional for backward compatibility with pre-F2 emits already
   * persisted in the audit log.
   */
  failureKind?: "cancel_driven" | "retry_exhausted" | "bulk_entry";
  /** Short reason string from the caught error. Not user-facing. */
  reason: string;
}

// ── Organization ─────────────────────────────────────────────────────────────

export interface OrganizationCreatedEvent extends BaseEventPayload {
  organization: Organization;
}

export interface OrganizationUpdatedEvent extends BaseEventPayload {
  organizationId: string;
  changes: Record<string, unknown>;
}

export interface MemberAddedEvent extends BaseEventPayload {
  organizationId: string;
  memberId: string;
}

export interface MemberRemovedEvent extends BaseEventPayload {
  organizationId: string;
  memberId: string;
}

export interface MemberRoleChangedEvent extends BaseEventPayload {
  organizationId: string;
  memberId: string;
  newRole: string;
}

// ── Ticket Type ─────────────────────────────────────────────────────────────

export interface TicketTypeAddedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  ticketTypeId: string;
  ticketTypeName: string;
}

export interface TicketTypeUpdatedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  ticketTypeId: string;
  changes: Record<string, unknown>;
}

export interface TicketTypeRemovedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  ticketTypeId: string;
  ticketTypeName: string;
}

// ── Payment ─────────────────────────────────────────────────────────────────

export interface PaymentInitiatedEvent extends BaseEventPayload {
  paymentId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  amount: number;
  method: string;
}

export interface PaymentSucceededEvent extends BaseEventPayload {
  paymentId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  amount: number;
}

export interface PaymentFailedEvent extends BaseEventPayload {
  paymentId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
}

/**
 * Fires when a payment is finalised via the verify-on-return path
 * (POST /v1/payments/:paymentId/verify) instead of via the provider's
 * IPN webhook. The user has been redirected back from the provider
 * checkout and we proactively call `provider.verify()` server-side to
 * read the official payment state — used as a robust fallback when
 * the provider's IPN delivery is unreliable (notably PayDunya
 * sandbox).
 *
 * Always co-fires with the canonical `payment.succeeded` /
 * `payment.failed` event when the verify-on-return flow flips a
 * Payment terminal — listeners that care about the actual payment
 * outcome subscribe to those, this event is purely audit-facing so
 * operators can see HOW the finalisation happened (IPN vs. user-
 * triggered verify) when investigating a discrepancy.
 *
 * `outcome` mirrors the canonical event that fired (`succeeded` /
 * `failed`); `pending` means the verify call returned non-terminal,
 * so neither canonical event fired and the Payment stays in
 * `processing` waiting for a future poll or IPN.
 *
 * See ADR-0018 for the full dual-path design rationale.
 */
export interface PaymentVerifiedFromRedirectEvent extends BaseEventPayload {
  paymentId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  /** Final state observed via provider.verify(). */
  outcome: "succeeded" | "failed" | "pending";
  /** Provider name (paydunya / wave / orange_money / mock). */
  providerName: string;
}

/**
 * Phase 3 reconciliation cron heartbeat. Emitted exactly once per
 * cron invocation (every 10 min in prod) — captures the aggregate
 * outcome of the sweep so operators can size the IPN-reliability
 * gap from the audit log over time.
 *
 * NOT a per-payment event: each payment that the sweep finalises
 * also emits the canonical `payment.succeeded` / `payment.failed`
 * (for the state flip) AND `payment.verified_from_redirect`
 * (with `outcome: succeeded|failed|pending`, source-tagged via the
 * `actorId: "system:payment.reconciliation"`). This event is the
 * cron-level summary on top of those.
 *
 * `errored` is the count of payments that threw during their
 * individual reconciliation attempt — the sweep never aborts on a
 * single failure; per-payment errors are logged + counted here.
 *
 * See ADR-0018 §"Phase 3 daily reconciliation" + the cron in
 * `apps/functions/src/triggers/payment.triggers.ts`.
 */
export interface PaymentReconciliationSweptEvent extends BaseEventPayload {
  scanned: number;
  finalizedSucceeded: number;
  finalizedFailed: number;
  stillPending: number;
  errored: number;
  windowMinMs: number;
  windowMaxMs: number;
}

/**
 * Fires when a payment expires WITHOUT reaching `succeeded`. Two
 * distinct trigger paths converge on this event:
 *
 *   1. Auto-expirer (Cloud Function `onPaymentTimeout`, every 5 min)
 *      flips payments stuck in `pending` / `processing` past the
 *      configured TTL. `reason = "timeout"`.
 *   2. User-initiated cancel of a `pending_payment` registration
 *      via `POST /v1/registrations/:id/cancel-pending`. The linked
 *      Payment doc (if any) is flipped here to release the slot.
 *      `reason = "user_cancelled"`.
 *
 * Distinct from `payment.failed` (provider explicitly rejected) so
 * the audit trail + notification dispatcher can render targeted
 * copy ("votre paiement a expiré, vous pouvez retenter") instead
 * of the generic provider-rejection wording.
 */
export interface PaymentExpiredEvent extends BaseEventPayload {
  paymentId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  /** Discriminator — drives the dispatcher's template selection. */
  reason: "timeout" | "user_cancelled";
}

export interface PaymentRefundedEvent extends BaseEventPayload {
  paymentId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  amount: number;
  reason?: string;
}

/**
 * Fires when a refund has been successfully issued by the provider
 * and committed to our ledger. Distinct from `payment.refunded` —
 * which is the generic audit/state-transition event (fires on every
 * refund regardless of outcome). `refund.issued` drives the
 * customer-facing "refund issued" email template. Split so future
 * refund flows can stamp a `refundId` / provider metadata without
 * polluting the audit stream's contract.
 */
export interface RefundIssuedEvent extends BaseEventPayload {
  paymentId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  amount: number;
  reason?: string;
}

/**
 * Fires when the refund processor reports failure (e.g. provider
 * refused, funds unreachable, stale transaction). Drives the
 * customer-facing "refund failed — contact support" email.
 * `failureReason` is a short string for internal use — never rendered
 * directly into the template, the UI copy is pre-baked.
 */
export interface RefundFailedEvent extends BaseEventPayload {
  paymentId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  amount: number;
  failureReason: string;
}

// ── Badge ────────────────────────────────────────────────────────────────────

export interface BadgeGeneratedEvent extends BaseEventPayload {
  badgeId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  userId: string;
}

/**
 * Aggregate event for `BadgeService.bulkGenerate`. Per-badge
 * `badge.generated` emission would flood the audit trail for a 500-user
 * event without adding signal; we carry a single summary per bulk call.
 * Mirrors the existing `checkin.bulk_synced` pattern.
 */
export interface BadgeBulkGeneratedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  templateId: string | null;
  /** Number of new badge docs created in this bulk call. */
  created: number;
}

// ── Broadcast ──────────────────────────────────────────────────────────────

export interface BroadcastSentEvent extends BaseEventPayload {
  broadcastId: string;
  eventId: string;
  organizationId: string;
  channels: string[];
  recipientCount: number;
}

// ── Newsletter ─────────────────────────────────────────────────────────────
// Platform-wide (no event or organization scope). Kept separate from
// BroadcastSentEvent, which is organizer→participants and carries eventId /
// organizationId required fields.

export interface NewsletterSubscriberCreatedEvent extends BaseEventPayload {
  subscriberId: string;
  email: string;
  source: string;
}

export interface NewsletterSubscriberConfirmedEvent extends BaseEventPayload {
  subscriberId: string;
  email: string;
  /** ISO 8601 — when the user completed the double-opt-in click. */
  confirmedAt: string;
}

export interface NewsletterSentEvent extends BaseEventPayload {
  /** Resend broadcast id. */
  broadcastId: string;
  subject: string;
  segmentId: string;
}

// ── Notification preferences (Phase 3c.4) ─────────────────────────────────

export interface NotificationUnsubscribedEvent extends BaseEventPayload {
  /** User whose preference was flipped (== actorId for self-service unsubs). */
  userId: string;
  /** Category unsubscribed from. Never "auth" or "billing" — those are mandatory. */
  category: "transactional" | "organizational" | "marketing";
  /** "list_unsubscribe_click" (GET) or "list_unsubscribe_post" (RFC 8058). */
  source: "list_unsubscribe_click" | "list_unsubscribe_post";
}

/**
 * Phase 2.5 — emitted when a user reverses a per-key opt-out from the
 * history page. Mirrors NotificationUnsubscribedEvent for audit-trail
 * symmetry so the admin audit UI can show both sides of the story.
 */
export interface NotificationResubscribedEvent extends BaseEventPayload {
  /** User whose preference flipped back to enabled. */
  userId: string;
  /** The catalog key the user resubscribed to. */
  key: string;
}

// ── Notification dispatcher (Phase 1) ────────────────────────────────────
// Emitted by NotificationService.dispatch on every channel delivery,
// every suppression decision, and every super-admin write to
// notificationSettings. Fire-and-forget audit trail — see audit.listener
// for the auditLogs mapping.

export interface NotificationSentEvent extends BaseEventPayload {
  /** Catalog key from packages/shared-types/src/notification-catalog.ts. */
  key: string;
  channel: "email" | "sms" | "push" | "in_app";
  /** Opaque recipient id for logs — userId when authenticated, else "email:<redacted>". */
  recipientRef: string;
  /** Provider-returned message id when available (e.g. Resend's id). */
  messageId?: string;
}

export interface NotificationSuppressedEvent extends BaseEventPayload {
  key: string;
  recipientRef: string;
  reason: "admin_disabled" | "user_opted_out" | "on_suppression_list" | "bounced" | "no_recipient";
  channel?: "email" | "sms" | "push" | "in_app";
}

/**
 * Phase 2.2 — emitted when the dispatcher short-circuits a duplicate
 * emit using the persistent idempotency log. Distinct from
 * notification.sent (no provider round-trip happened) and from
 * notification.suppressed (no decision was made — we just deferred
 * to the previous send). Powers the admin "duplicates caught" widget
 * and alerts on retry storms.
 */
export interface NotificationDeduplicatedEvent extends BaseEventPayload {
  key: string;
  channel: "email" | "sms" | "push" | "in_app";
  recipientRef: string;
  /** The idempotency key that matched a prior log entry. */
  idempotencyKey: string;
  /** Timestamp of the prior entry that caused the dedup. */
  originalAttemptedAt: string;
}

export interface NotificationSettingUpdatedEvent extends BaseEventPayload {
  key: string;
  /** Phase 2.4 — null for platform-wide overrides, orgId for per-org overrides. */
  organizationId: string | null;
  enabled: boolean;
  channels: ("email" | "sms" | "push" | "in_app")[];
  hasSubjectOverride: boolean;
  /** Doc id of the notificationSettingsHistory entry appended alongside the update. */
  historyId?: string;
}

/**
 * Phase 2.4 — emitted when a super_admin issues a "test send" from the
 * notifications control plane. Distinct from notification.sent so stats
 * widgets and the dispatch log can filter these previews out of real
 * delivery counters.
 */
export interface NotificationTestSentEvent extends BaseEventPayload {
  key: string;
  channel: "email" | "sms" | "push" | "in_app";
  /** Redacted recipient — mirrors the recipientRef format used elsewhere. */
  recipientRef: string;
  /** Locale the preview was rendered in. */
  locale: "fr" | "en" | "wo";
  /** Provider-returned message id when available. */
  messageId?: string;
}

/**
 * Phase B.1 — emitted when a user issues a self-targeted test send from
 * the preferences UI (POST /v1/notifications/test-send). Kept separate
 * from `notification.test_sent` (admin-triggered previews) so the audit
 * trail can distinguish who asked for the send and so admin-stats
 * widgets can filter self-sends out of operational test volume.
 */
export interface NotificationTestSentSelfEvent extends BaseEventPayload {
  /** Catalog key the user asked to test. */
  key: string;
  /** uid of the caller — same value appears as `actorId`, duplicated here for audit clarity. */
  userId: string;
  /** Locale the preview was rendered in (derived from the user doc). */
  locale: "fr" | "en" | "wo";
}

/**
 * Phase D.3 — emitted when a super_admin opens the delivery-observability
 * dashboard (GET /v1/admin/notifications/delivery). Audited because the
 * endpoint exposes a cross-tenant view of notification traffic, including
 * per-key, per-channel volumes. The payload echoes the query so compliance
 * reviewers can replay what the admin actually saw.
 */
export interface AdminDeliveryDashboardViewedEvent extends BaseEventPayload {
  /** Optional catalog-key filter applied to the query. */
  key?: string;
  /** Optional channel filter applied to the query. */
  channel?: "email" | "sms" | "push" | "in_app";
  /** ISO window start (inclusive). */
  windowStart: string;
  /** ISO window end (inclusive). */
  windowEnd: string;
  /** Granularity the response was bucketed at. */
  granularity: "hour" | "day";
  /** Number of dispatch-log rows scanned — helps reviewers spot when the
   *  hard cap was hit. */
  scanned: number;
}

// ── User lifecycle (Phase 2 — security + onboarding notifications) ───────
// Emitted by the auth trigger (user.created) and the API self-service
// endpoints for password + email changes. The notification listener
// routes each to its dispatcher key so the Welcome / PasswordChanged /
// EmailChanged templates fire. Password + email changes are SECURITY
// notifications — userOptOutAllowed=false in the catalog, dispatcher
// ignores opt-out.

export interface UserCreatedEvent extends BaseEventPayload {
  /** Firebase UID of the newly-created user. */
  userId: string;
  /** Email captured at sign-up; may be null for anonymous Firebase users. */
  email: string | null;
  displayName: string | null;
  /** "email" | "google" | "anonymous" — provider Firebase returned. */
  provider: string;
}

export interface UserPasswordChangedEvent extends BaseEventPayload {
  userId: string;
  /** ISO timestamp when the password was rotated. */
  changedAt: string;
  /** Best-effort client IP (X-Forwarded-For). Absent = originated from a cron / admin action. */
  ipAddress?: string;
  /** Best-effort city from GeoIP. Absent = unknown. */
  city?: string;
}

export interface UserEmailChangedEvent extends BaseEventPayload {
  userId: string;
  /** Previous email — the notification target (sent to the OLD address for security). */
  oldEmail: string;
  /** New email on the account. */
  newEmail: string;
  changedAt: string;
}

// ── FCM device tokens (Phase C.1 — Web Push) ──────────────────────────────
// Emitted by FcmTokensService on register / refresh / revoke. The raw FCM
// token NEVER lands on the event bus or in audit logs — we emit only the
// sha256 fingerprint (first 16 hex chars) so forensics can correlate "which
// device" without carrying a replayable push credential in the trail.

export interface FcmTokenRegisteredEvent extends BaseEventPayload {
  userId: string;
  platform: "web" | "ios" | "android";
  /** sha256(token).slice(0, 16) — never the raw token. */
  tokenFingerprint: string;
  /** Total tokens on the user doc after this write (post-cap, post-dedupe). */
  tokenCount: number;
  /** "registered" = new entry appended, "refreshed" = existing entry bumped. */
  status: "registered" | "refreshed";
}

export interface FcmTokenRevokedEvent extends BaseEventPayload {
  userId: string;
  /** sha256(token).slice(0, 16) — the fingerprint the client sent. */
  tokenFingerprint: string;
  /** Whether a matching token was found and removed. */
  removed: boolean;
  /** Total tokens on the user doc after the revoke. */
  tokenCount: number;
}

export interface FcmTokensClearedEvent extends BaseEventPayload {
  userId: string;
  /** Number of tokens removed — may be 0 if the user had none. */
  removedCount: number;
}

// ── Web Push back-annotations (Phase C.2) ───────────────────────────────
// Emitted when the SW pings /v1/notifications/:id/push-displayed (on
// `showNotification`) or /v1/notifications/:id/push-clicked (on
// `notificationclick`). Both carry the user id (from Bearer token when
// present) + the notification id off the payload.data — that's enough
// for a future "delivered vs clicked" dashboard to join against the
// dispatchLog by notificationId without storing device-level PII.
//
// These are observability-only events — no user action the server needs
// to react to. Listeners should be append-only writes (audit trail) and
// an eventual back-annotation on the dispatch log row.

export interface PushDisplayedEvent extends BaseEventPayload {
  userId: string;
  /** Notification doc id in Firestore. */
  notificationId: string;
}

export interface PushClickedEvent extends BaseEventPayload {
  userId: string;
  notificationId: string;
}

// ── Subscription billing (Phase 2) ───────────────────────────────────────
// `past_due` is emitted by the future billing cron when auto-renewal
// fails; the doc gap is acknowledged in the roadmap. `cancelled` is
// emitted by the subscription-cancel path (distinct from downgrade —
// downgrade emits subscription.downgraded with the target plan, cancel
// reverts the org to the free plan explicitly).

export interface SubscriptionPastDueEvent extends BaseEventPayload {
  organizationId: string;
  planKey: string;
  /** Pre-formatted XOF amount for the template. */
  amount: string;
  /** Short provider-returned reason, never user-facing raw. */
  failureReason?: string;
  /** ISO timestamp when the org rolls back to the free plan if unpaid. */
  gracePeriodEndsAt: string;
}

export interface SubscriptionCancelledEvent extends BaseEventPayload {
  organizationId: string;
  planKey: string;
  /** ISO timestamp when the cancellation becomes effective. */
  effectiveAt: string;
  /** "self" (admin clicked cancel) | "system" (past_due grace expired). */
  cancelledBy: "self" | "system";
}

// ── Phase 2.3 — lifecycle nudges ────────────────────────────────────────
// Scheduled/triggered notification events that close the feedback loop
// after events end, surface certificates, and nudge organizers when
// their subscription is about to expire or near a plan-cap.

/**
 * Fires from the post-event scheduled function (2h after an event ends)
 * per checked-in registrant. Drives the `event.feedback_requested` email
 * and in-app notification.
 */
export interface EventFeedbackRequestedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  /** The specific user being nudged. */
  userId: string;
  /** Pre-formatted feedback deadline (optional), e.g. "29 avril 2026". */
  feedbackDeadline?: string;
}

/**
 * Fires when an organizer clicks "Issue certificates" in the back-office.
 * Payload carries the eventId + organizationId + the list of registrant
 * user ids whose certificate is now downloadable. The dispatcher listener
 * fans out one email per userId — certificateUrl is resolved per-user
 * from the certificate service (signed URL).
 */
export interface EventCertificatesIssuedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  /** User ids eligible to receive a certificate (checked-in attendees). */
  userIds: string[];
  /** Optional link validity hint surfaced to the recipient. */
  validityHint?: string;
}

/**
 * Fires from the subscription-reminder scheduled function exactly once
 * when `daysUntilRenewal == 7` for a paid, active subscription. Payload
 * carries pre-formatted copy so the listener doesn't need the
 * subscription repository.
 */
export interface SubscriptionExpiringSoonEvent extends BaseEventPayload {
  organizationId: string;
  planKey: string;
  /** Pre-formatted XOF amount for the template. */
  amount: string;
  /** ISO timestamp of the current period end. */
  renewalAt: string;
  daysUntilRenewal: number;
}

/**
 * Fires (at most) once per day per org when any plan usage dimension
 * crosses 80%. `dimension` is a stable key (events/members/participants);
 * listeners translate it to a localized label.
 */
export interface SubscriptionApproachingLimitEvent extends BaseEventPayload {
  organizationId: string;
  planKey: string;
  dimension: "events" | "members" | "participants";
  current: number;
  limit: number;
  /** Rounded percentage (0-100). */
  percent: number;
}

// ── Speaker ───────────────────────────────────────────────────────────────

export interface SpeakerAddedEvent extends BaseEventPayload {
  speakerId: string;
  eventId: string;
  organizationId: string;
  name: string;
}

export interface SpeakerRemovedEvent extends BaseEventPayload {
  speakerId: string;
  eventId: string;
  organizationId: string;
}

// ── Sponsor ───────────────────────────────────────────────────────────────

export interface SponsorAddedEvent extends BaseEventPayload {
  sponsorId: string;
  eventId: string;
  organizationId: string;
  companyName: string;
  tier: string;
}

export interface SponsorRemovedEvent extends BaseEventPayload {
  sponsorId: string;
  eventId: string;
  organizationId: string;
}

export interface SponsorLeadCapturedEvent extends BaseEventPayload {
  leadId: string;
  sponsorId: string;
  eventId: string;
  participantId: string;
}

// ── Promo Code ──────────────────────────────────────────────────────────────

export interface PromoCodeCreatedEvent extends BaseEventPayload {
  promoCodeId: string;
  eventId: string;
  organizationId: string;
  code: string;
}

export interface PromoCodeUsedEvent extends BaseEventPayload {
  promoCodeId: string;
}

export interface PromoCodeDeactivatedEvent extends BaseEventPayload {
  promoCodeId: string;
  eventId: string;
  code: string;
}

// ── Venue ────────────────────────────────────────────────────────────────────

export interface VenueCreatedEvent extends BaseEventPayload {
  venueId: string;
  name: string;
  hostOrganizationId?: string;
}

export interface VenueUpdatedEvent extends BaseEventPayload {
  venueId: string;
  changes: Record<string, unknown>;
}

export interface VenueApprovedEvent extends BaseEventPayload {
  venueId: string;
  name: string;
}

export interface VenueSuspendedEvent extends BaseEventPayload {
  venueId: string;
  name: string;
}

export interface VenueReactivatedEvent extends BaseEventPayload {
  venueId: string;
  name: string;
}

// ── Admin ────────────────────────────────────────────────────────────────────

export interface UserRoleChangedEvent extends BaseEventPayload {
  targetUserId: string;
  oldRoles: string[];
  newRoles: string[];
}

export interface UserStatusChangedEvent extends BaseEventPayload {
  targetUserId: string;
  isActive: boolean;
}

export interface OrgVerifiedEvent extends BaseEventPayload {
  organizationId: string;
}

export interface OrgStatusChangedEvent extends BaseEventPayload {
  organizationId: string;
  isActive: boolean;
}

// ── Feed Post ──────────────────────────────────────────────────────────────

export interface FeedPostCreatedEvent extends BaseEventPayload {
  postId: string;
  eventId: string;
  authorId: string;
  isAnnouncement: boolean;
}

export interface FeedPostUpdatedEvent extends BaseEventPayload {
  postId: string;
  eventId: string;
}

export interface FeedPostDeletedEvent extends BaseEventPayload {
  postId: string;
  eventId: string;
}

export interface FeedPostPinnedEvent extends BaseEventPayload {
  postId: string;
  eventId: string;
  pinned: boolean;
}

// ── Session ────────────────────────────────────────────────────────────────

export interface SessionCreatedEvent extends BaseEventPayload {
  sessionId: string;
  eventId: string;
  title: string;
}

export interface SessionUpdatedEvent extends BaseEventPayload {
  sessionId: string;
  eventId: string;
  changes: string[];
}

export interface SessionDeletedEvent extends BaseEventPayload {
  sessionId: string;
  eventId: string;
  title: string;
}

// ── Messaging ──────────────────────────────────────────────────────────────

export interface MessageSentEvent extends BaseEventPayload {
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
}

// ── Invite ─────────────────────────────────────────────────────────────────

export interface InviteCreatedEvent extends BaseEventPayload {
  inviteId: string;
  organizationId: string;
  email: string;
  role: string;
}

export interface InviteAcceptedEvent extends BaseEventPayload {
  inviteId: string;
  organizationId: string;
  userId: string;
}

export interface InviteDeclinedEvent extends BaseEventPayload {
  inviteId: string;
  organizationId: string;
}

export interface InviteRevokedEvent extends BaseEventPayload {
  inviteId: string;
  organizationId: string;
  email: string;
}

// ── Payout ─────────────────────────────────────────────────────────────────

export interface PayoutCreatedEvent extends BaseEventPayload {
  payoutId: string;
  eventId: string;
  organizationId: string;
  netAmount: number;
}

// ── Receipt ─────────────────────────────────────────────────────────────────

export interface ReceiptGeneratedEvent extends BaseEventPayload {
  receiptId: string;
  paymentId: string;
  eventId: string;
  organizationId: string;
  userId: string;
  amount: number;
}

// ── Subscription ────────────────────────────────────────────────────────────

export interface SubscriptionUpgradedEvent extends BaseEventPayload {
  organizationId: string;
  previousPlan: string;
  newPlan: string;
  /**
   * Phase 7+ item #7 — snapshot of the plan coupon redeemed alongside
   * the upgrade (null/absent when no coupon was applied). Carried on
   * the event payload so downstream listeners (audit, future webhook
   * + billing analytics) can distinguish coupon upgrades without
   * re-reading the subscription doc. The canonical audit trail is the
   * `couponRedemptions` collection + the `subscription.appliedCoupon`
   * denorm field — this payload is a convenience echo for listeners
   * that don't want to take a Firestore dependency.
   */
  appliedCoupon?: {
    couponId: string;
    code: string;
    discountXof: number;
    finalPriceXof: number;
  } | null;
}

export interface SubscriptionDowngradedEvent extends BaseEventPayload {
  organizationId: string;
  previousPlan: string;
  newPlan: string;
}

// ── Subscription lifecycle (Phase 4c) ───────────────────────────────────────

export interface SubscriptionChangeScheduledEvent extends BaseEventPayload {
  organizationId: string;
  fromPlan: string;
  toPlan: string;
  effectiveAt: string;
  reason: string;
}

export interface SubscriptionScheduledRevertedEvent extends BaseEventPayload {
  organizationId: string;
  revertedToPlan: string;
  revertedEffectiveAt: string;
}

export interface SubscriptionPeriodRolledOverEvent extends BaseEventPayload {
  organizationId: string;
  fromPlan: string;
  toPlan: string;
  reason: string;
}

export interface SubscriptionOverriddenEvent extends BaseEventPayload {
  organizationId: string;
  previousPlan: string;
  newPlanKey: string;
  newPlanId: string;
  hasOverrides: boolean;
  validUntil: string | null;
}

// ── Plan Catalog ─────────────────────────────────────────────────────────────

export interface PlanCreatedEvent extends BaseEventPayload {
  planId: string;
  key: string;
}

export interface PlanUpdatedEvent extends BaseEventPayload {
  planId: string;
  key: string;
  changes: string[];
}

export interface PlanArchivedEvent extends BaseEventPayload {
  planId: string;
  key: string;
}

// ─── Domain Event Map ────────────────────────────────────────────────────────
// Type-safe mapping of event names to their payloads.
// Adding a new event here gives compile-time safety across all emitters/listeners.

export interface DomainEventMap {
  "registration.created": RegistrationCreatedEvent;
  "registration.cancelled": RegistrationCancelledEvent;
  "registration.approved": RegistrationApprovedEvent;
  "checkin.completed": CheckInCompletedEvent;
  "checkin.bulk_synced": BulkCheckinSyncedEvent;
  "checkin.offline_sync.downloaded": OfflineSyncDownloadedEvent;
  "access_zone.added": AccessZoneAddedEvent;
  "access_zone.updated": AccessZoneUpdatedEvent;
  "access_zone.removed": AccessZoneRemovedEvent;
  "event.created": EventCreatedEvent;
  "event.updated": EventUpdatedEvent;
  "event.rescheduled": EventRescheduledEvent;
  "event.qr_key_rotated": EventQrKeyRotatedEvent;
  "event.published": EventPublishedEvent;
  "event.unpublished": EventUnpublishedEvent;
  "event.cancelled": EventCancelledEvent;
  "event.archived": EventArchivedEvent;
  "event.restored": EventRestoredEvent;
  "event.cloned": EventClonedEvent;
  // Recurring events (Phase 7+ item #B1)
  "event.series_created": EventSeriesCreatedEvent;
  "event.series_published": EventSeriesPublishedEvent;
  "event.series_cancelled": EventSeriesCancelledEvent;
  "scheduled_admin_op.created": ScheduledAdminOpCreatedEvent;
  "scheduled_admin_op.updated": ScheduledAdminOpUpdatedEvent;
  "scheduled_admin_op.deleted": ScheduledAdminOpDeletedEvent;
  "waitlist.promoted": WaitlistPromotedEvent;
  "waitlist.promotion_failed": WaitlistPromotionFailedEvent;
  // B2 follow-up — aggregate row for bulk-promote calls.
  "waitlist.bulk_promoted": WaitlistBulkPromotedEvent;
  "ticket_type.added": TicketTypeAddedEvent;
  "ticket_type.updated": TicketTypeUpdatedEvent;
  "ticket_type.removed": TicketTypeRemovedEvent;
  "organization.created": OrganizationCreatedEvent;
  "organization.updated": OrganizationUpdatedEvent;
  "member.added": MemberAddedEvent;
  "member.removed": MemberRemovedEvent;
  "member.role_changed": MemberRoleChangedEvent;
  "badge.generated": BadgeGeneratedEvent;
  "badge.bulk_generated": BadgeBulkGeneratedEvent;
  "payment.initiated": PaymentInitiatedEvent;
  "payment.succeeded": PaymentSucceededEvent;
  "payment.failed": PaymentFailedEvent;
  "payment.verified_from_redirect": PaymentVerifiedFromRedirectEvent;
  "payment.reconciliation_swept": PaymentReconciliationSweptEvent;
  // Phase 2 follow-up — explicit expiration distinct from `failed`.
  // Triggered by the auto-expirer cron OR by user-initiated cancel
  // of a pending_payment registration. See `PaymentExpiredEvent`
  // for the `reason` discriminator.
  "payment.expired": PaymentExpiredEvent;
  "payment.refunded": PaymentRefundedEvent;
  "refund.issued": RefundIssuedEvent;
  "refund.failed": RefundFailedEvent;
  "broadcast.sent": BroadcastSentEvent;
  "speaker.added": SpeakerAddedEvent;
  "speaker.removed": SpeakerRemovedEvent;
  "sponsor.added": SponsorAddedEvent;
  "sponsor.removed": SponsorRemovedEvent;
  "sponsor.lead_captured": SponsorLeadCapturedEvent;
  "promo_code.created": PromoCodeCreatedEvent;
  "promo_code.used": PromoCodeUsedEvent;
  "promo_code.deactivated": PromoCodeDeactivatedEvent;
  // Venue
  "venue.created": VenueCreatedEvent;
  "venue.updated": VenueUpdatedEvent;
  "venue.approved": VenueApprovedEvent;
  "venue.suspended": VenueSuspendedEvent;
  "venue.reactivated": VenueReactivatedEvent;
  // Feed Post
  "feed_post.created": FeedPostCreatedEvent;
  "feed_post.updated": FeedPostUpdatedEvent;
  "feed_post.deleted": FeedPostDeletedEvent;
  "feed_post.pinned": FeedPostPinnedEvent;
  // Session
  "session.created": SessionCreatedEvent;
  "session.updated": SessionUpdatedEvent;
  "session.deleted": SessionDeletedEvent;
  // Messaging
  "message.sent": MessageSentEvent;
  // Invite
  "invite.created": InviteCreatedEvent;
  "invite.accepted": InviteAcceptedEvent;
  "invite.declined": InviteDeclinedEvent;
  "invite.revoked": InviteRevokedEvent;
  // Receipt
  "receipt.generated": ReceiptGeneratedEvent;
  // Subscription
  "subscription.upgraded": SubscriptionUpgradedEvent;
  "subscription.downgraded": SubscriptionDowngradedEvent;
  "subscription.change_scheduled": SubscriptionChangeScheduledEvent;
  "subscription.scheduled_reverted": SubscriptionScheduledRevertedEvent;
  "subscription.period_rolled_over": SubscriptionPeriodRolledOverEvent;
  "subscription.overridden": SubscriptionOverriddenEvent;
  // Plan Catalog
  "plan.created": PlanCreatedEvent;
  "plan.updated": PlanUpdatedEvent;
  "plan.archived": PlanArchivedEvent;
  // Payout
  "payout.created": PayoutCreatedEvent;
  // Admin
  "user.role_changed": UserRoleChangedEvent;
  "user.status_changed": UserStatusChangedEvent;
  "organization.verified": OrgVerifiedEvent;
  "organization.status_changed": OrgStatusChangedEvent;
  // Newsletter
  "newsletter.subscriber_created": NewsletterSubscriberCreatedEvent;
  "newsletter.subscriber_confirmed": NewsletterSubscriberConfirmedEvent;
  "newsletter.sent": NewsletterSentEvent;
  // Notification preferences
  "notification.unsubscribed": NotificationUnsubscribedEvent;
  "notification.resubscribed": NotificationResubscribedEvent;
  // Notification dispatcher (Phase 1)
  "notification.sent": NotificationSentEvent;
  "notification.suppressed": NotificationSuppressedEvent;
  "notification.setting_updated": NotificationSettingUpdatedEvent;
  // Phase 2.4 — admin "test send" path.
  "notification.test_sent": NotificationTestSentEvent;
  // Phase B.1 — user self-triggered test send from the preferences UI.
  "notification.test_sent_self": NotificationTestSentSelfEvent;
  // Notification dispatcher (Phase 2.2 — persistent dedup)
  "notification.deduplicated": NotificationDeduplicatedEvent;
  // Super-admin delivery-observability dashboard viewed (Phase D.3).
  "admin.delivery_dashboard_viewed": AdminDeliveryDashboardViewedEvent;
  // User lifecycle (Phase 2)
  "user.created": UserCreatedEvent;
  "user.password_changed": UserPasswordChangedEvent;
  "user.email_changed": UserEmailChangedEvent;
  // FCM device tokens (Phase C.1 — Web Push)
  "fcm.token_registered": FcmTokenRegisteredEvent;
  "fcm.token_revoked": FcmTokenRevokedEvent;
  "fcm.tokens_cleared": FcmTokensClearedEvent;
  // Web Push back-annotations (Phase C.2)
  "push.displayed": PushDisplayedEvent;
  "push.clicked": PushClickedEvent;
  // Subscription billing (Phase 2)
  "subscription.past_due": SubscriptionPastDueEvent;
  "subscription.cancelled": SubscriptionCancelledEvent;
  // Phase 2.3 — post-event + lifecycle nudges
  "event.feedback_requested": EventFeedbackRequestedEvent;
  "event.certificates_issued": EventCertificatesIssuedEvent;
  "subscription.expiring_soon": SubscriptionExpiringSoonEvent;
  "subscription.approaching_limit": SubscriptionApproachingLimitEvent;
  // Admin overhaul Phase 4 — impersonation audit signal. Listeners can
  // react (security alerting, rate limiting) when a super-admin starts
  // a session on behalf of another user. Under the auth-code flow this
  // is emitted at CODE-ISSUE time (before any token is minted). The
  // matching `user.impersonation_exchanged` fires when the target app
  // actually consumes the code; the pair gives reviewers a full view
  // of whether issued codes were ever redeemed.
  "user.impersonated": UserImpersonatedEvent;
  // OAuth-style exchange signal — the target app called
  // /v1/impersonation/exchange and a Firebase custom token was minted.
  // Paired with user.impersonated (same actor uid, same target uid)
  // via the `requestId` field in the audit log.
  "user.impersonation_exchanged": UserImpersonationExchangedEvent;
  // Closure I — matching exit signal. Fired synchronously by
  // endImpersonation() after the impersonated user's refresh tokens
  // have been revoked. Parity with `user.impersonated` so security
  // listeners see both halves of a session.
  "user.impersonation_ended": UserImpersonationEndedEvent;
  // T2.2 — admin job runner. Triggered fires at handler start, before
  // any side-effect; completed fires after the handler returns or
  // throws (see `status`). Pair via `runId`. Downstream listeners:
  // security alerting (high-volume job triggers), observability
  // dashboards.
  "admin.job_triggered": AdminJobTriggeredEvent;
  "admin.job_completed": AdminJobCompletedEvent;
  // T2.2 — emitted per batch commit by the prune-expired-invites
  // handler. One event per ≤ 400-row commit, carries the count +
  // runId so the audit trail has a fine-grained record of bulk
  // mutations beyond the coarse `admin.job_completed` summary.
  // Precedent: `checkin.bulk_synced`.
  "invite.bulk_expired": InviteBulkExpiredEvent;
  // P1-21 (audit L1) — emitted per batch commit by the
  // `expire-stale-payments` handler. One event per ≤ 400-row commit,
  // carries the count + cutoff + runId so the audit trail has a
  // fine-grained record of bulk Payment expirations. Mirrors
  // `invite.bulk_expired`.
  "payment.bulk_expired": PaymentBulkExpiredEvent;
  // Phase 2 / threat T-PD-03 — fires when `handleWebhook` rejects an
  // IPN whose anti-tampering invariants didn't hold (mismatched
  // amount / payment_id, missing required fields on a PayDunya
  // payload). Lets the audit listener record the attempt so
  // post-incident analysis can spot recon attempts that signature-
  // verify but try to bind to a different Payment.
  "payment.tampering_attempted": PaymentTamperingAttemptedEvent;
  // T2.1 — admin replayed a stored webhook event from /admin/webhooks.
  // Fires at replay start (before the handler runs) so security
  // listeners see the attempt even if the handler hangs.
  "admin.webhook_replayed": AdminWebhookReplayedEvent;
  // T2.3 — API key lifecycle. Created / revoked fire as singletons;
  // rotated fires in addition to the revoked+created pair so the audit
  // stream can distinguish "leaked → rotated" from two unrelated
  // create+revoke events.
  "api_key.created": ApiKeyCreatedEvent;
  "api_key.revoked": ApiKeyRevokedEvent;
  "api_key.rotated": ApiKeyRotatedEvent;
  "api_key.verified": ApiKeyVerifiedEvent;
  // Phase O6 — WhatsApp opt-in + delivery
  "whatsapp.opt_in.granted": WhatsappOptInGrantedEvent;
  "whatsapp.opt_in.revoked": WhatsappOptInRevokedEvent;
  "whatsapp.delivery.failed": WhatsappDeliveryFailedEvent;
  // Phase O7 — Participant ops
  "participant_profile.updated": ParticipantProfileUpdatedEvent;
  "participant.merged": ParticipantMergedEvent;
  // Phase O8 — Live Event Mode (Floor Ops)
  "incident.created": IncidentCreatedEvent;
  "incident.updated": IncidentUpdatedEvent;
  "incident.resolved": IncidentResolvedEvent;
  "emergency_broadcast.sent": EmergencyBroadcastSentEvent;
  "staff_message.posted": StaffMessagePostedEvent;
  "post_event_report.generated": PostEventReportGeneratedEvent;
  "cohort_export.downloaded": CohortExportDownloadedEvent;
  "payout.requested": PayoutRequestedEvent;
  "event.cloned_from_template": EventClonedFromTemplateEvent;
  "magic_link.issued": MagicLinkIssuedEvent;
  "magic_link.used": MagicLinkUsedEvent;
  "magic_link.revoked": MagicLinkRevokedEvent;
  // Plan coupons (Phase 7+ item #7) — redemption itself is captured on
  // the subscription doc + couponRedemptions collection; we only emit
  // lifecycle signals here (create / update / archive).
  "plan_coupon.created": PlanCouponCreatedEvent;
  "plan_coupon.updated": PlanCouponUpdatedEvent;
  "plan_coupon.archived": PlanCouponArchivedEvent;
}

/** Phase 4 — emitted by adminService.startImpersonation(). */
export interface UserImpersonatedEvent {
  actorUid: string;
  targetUid: string;
  /** ISO timestamp when the minted token stops being accepted. */
  expiresAt: string;
}

/** Closure I — emitted by adminService.endImpersonation() after revoke. */
export interface UserImpersonationEndedEvent {
  actorUid: string;
  targetUid: string;
}

/**
 * OAuth-style exchange — emitted by ImpersonationCodeService.exchange()
 * AFTER the code has been atomically marked consumed AND the Firebase
 * custom token successfully minted. Consumed by security-alerting
 * listeners to distinguish an issued-but-never-redeemed code (possible
 * failed handoff) from a completed session.
 */
export interface UserImpersonationExchangedEvent {
  actorUid: string;
  targetUid: string;
  /** Session token's expiration — matches the ISO returned to the client. */
  expiresAt: string;
}

/** T2.2 — emitted at handler start by AdminJobsService.runJob(). */
export interface AdminJobTriggeredEvent {
  actorUid: string;
  jobKey: string;
  runId: string;
}

/** T2.2 — emitted on terminal status (succeeded / failed). */
export interface AdminJobCompletedEvent {
  actorUid: string;
  jobKey: string;
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  durationMs: number;
}

/**
 * T2.2 — emitted by the `prune-expired-invites` handler on each
 * ≤ 400-row batch commit. Carries the actor + run context so the
 * audit trail can attribute the bulk mutation to a specific job
 * invocation.
 */
export interface InviteBulkExpiredEvent {
  actorUid: string;
  jobKey: string;
  runId: string;
  count: number;
  processedAt: string;
}

/**
 * P1-21 (audit L1) — emitted by the `expire-stale-payments` handler
 * on each ≤ 400-row batch commit. Carries the actor + run context +
 * the cutoff used (so a forensic operator running with a non-default
 * staleAfterHours leaves a paper trail).
 */
export interface PaymentBulkExpiredEvent {
  actorUid: string;
  jobKey: string;
  runId: string;
  count: number;
  /** ISO-8601 cutoff used by this run (`now - staleAfterHours`). */
  cutoffIso: string;
  processedAt: string;
}

/**
 * Phase 2 / threat T-PD-03 — emitted by `handleWebhook` when the
 * anti-tampering cross-checks fail. The webhook signature verified
 * (so the request CAME from PayDunya), but the payload's bound
 * fields (`payment_id` / `amount`) don't match the Payment doc.
 * That's either a payload-tampering attempt by a man-in-the-middle
 * or a config drift — either way, ops needs a paper trail.
 *
 * `requestId` is provided by the webhook route via the request
 * context; `actorId` is the synthetic `system:webhook` since the
 * IPN has no Firebase user attached.
 */
export interface PaymentTamperingAttemptedEvent {
  paymentId: string;
  organizationId: string;
  /** Discriminator: `payment_id` / `amount` / future fields. */
  field: string;
  /** What we expected (the value from `Payment.{id|amount}`). */
  expectedValue: string | number;
  /**
   * What the IPN claimed. Sliced to bounded length so a hostile
   * payload can't bloat the audit row.
   */
  receivedValue: string | number | null;
  /** Provider name from the metadata (`paydunya` today). */
  providerName: string;
  actorId: string;
  requestId: string;
  timestamp: string;
}

/** T2.1 — emitted by WebhookEventsService.replay() at attempt start. */
export interface AdminWebhookReplayedEvent {
  actorUid: string;
  webhookEventId: string;
  provider: string;
  providerTransactionId: string;
}

// ─── Plan Coupons (Phase 7+ item #7) ─────────────────────────────────────

/**
 * Emitted by PlanCouponService.create() after the doc commits.
 * Super-admin-only surface; audit listener maps to `plan_coupon.created`.
 * Redemptions are audited via the CouponRedemption doc itself (one row
 * per redeem inside the upgrade transaction), so there's no separate
 * `plan_coupon.redeemed` event — the subscription.upgraded payload
 * carries `appliedCoupon` instead.
 */
export interface PlanCouponCreatedEvent extends BaseEventPayload {
  couponId: string;
  code: string;
}

export interface PlanCouponUpdatedEvent extends BaseEventPayload {
  couponId: string;
  /** Whitelist of changed keys (never values — label/scope can be sensitive). */
  changes: string[];
}

export interface PlanCouponArchivedEvent extends BaseEventPayload {
  couponId: string;
}

// ─── API keys (T2.3) ─────────────────────────────────────────────────────

/**
 * T2.3 — emitted by ApiKeysService.issue() after the row commits.
 * Audit listener maps to `api_key.created` in auditLogs. Payload never
 * carries the plaintext key — only the non-secret metadata.
 */
export interface ApiKeyCreatedEvent extends BaseEventPayload {
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
  environment: "live" | "test";
  name: string;
}

/** T2.3 — emitted on status: active → revoked transition. */
export interface ApiKeyRevokedEvent extends BaseEventPayload {
  apiKeyId: string;
  organizationId: string;
  reason: string;
}

/**
 * T2.3 — emitted AFTER the atomic revoke-old + issue-new transaction
 * commits. Paired with api_key.revoked (for the old id) and
 * api_key.created (for the new id) via `requestId` in the audit log.
 */
export interface ApiKeyRotatedEvent extends BaseEventPayload {
  previousApiKeyId: string;
  newApiKeyId: string;
  organizationId: string;
}

/**
 * T2.3 (remediation) — throttled emission on each successful
 * authentication. Fires at most once per key per (hour × ipHash) so
 * SOC alerting can key on "key used from new IP / UA" without the
 * audit log exploding under a normal request rate. The throttle
 * state is kept in-memory per-pod (acceptable because a distributed
 * leak detector doesn't need perfect exactly-once — the key is
 * used from multiple pods and the aggregate signal is strictly
 * more accurate than a single-pod view).
 */
export interface ApiKeyVerifiedEvent extends BaseEventPayload {
  apiKeyId: string;
  organizationId: string;
  /** SHA-256 of the client IP, truncated to 16 hex chars — forensic-linkable, not personally identifying. */
  ipHash: string;
  /** SHA-256 of the user-agent, truncated to 16 hex chars. */
  uaHash: string;
}

// ─── Phase O6 — WhatsApp opt-in lifecycle + delivery failures ──────────────

/**
 * Privacy: the audit-bound payload intentionally OMITS the phone
 * number. The phone lives on the `whatsappOptIns/{userId_orgId}`
 * doc; an investigator with `whatsapp:read` joins from
 * `(userId, organizationId)` to retrieve it on demand. Mirror of
 * the magic-link recipient-email handling — PII does not enter the
 * immutable audit log per CLAUDE.md.
 */
export interface WhatsappOptInGrantedEvent extends BaseEventPayload {
  userId: string;
  organizationId: string;
  /** True when the participant re-grants after a previous revoke. */
  reGrant: boolean;
}

export interface WhatsappOptInRevokedEvent extends BaseEventPayload {
  userId: string;
  organizationId: string;
}

export interface WhatsappDeliveryFailedEvent extends BaseEventPayload {
  /** Meta message id (or `mock-wa-…` in dev). */
  messageId: string;
  /** Recipient E.164 phone number. */
  recipient: string;
  /** Optional Meta error code. */
  errorCode: string | null;
  /** Optional human-readable error from Meta. */
  errorMessage: string | null;
}

// ─── Phase O7 — Participant ops (tags / notes / merge) ────────────────────

export interface ParticipantProfileUpdatedEvent extends BaseEventPayload {
  organizationId: string;
  userId: string;
  /** Tags AFTER the update. */
  tags: string[];
  /** Whether the notes field was changed (we don't log the value for privacy). */
  notesChanged: boolean;
}

export interface ParticipantMergedEvent extends BaseEventPayload {
  organizationId: string;
  primaryUserId: string;
  secondaryUserId: string;
  /** Number of registrations re-pointed from secondary → primary. */
  registrationsMoved: number;
}

// ─── Phase O8 — Live Event Mode (Floor Ops) ──────────────────────────────

export interface IncidentCreatedEvent extends BaseEventPayload {
  incidentId: string;
  eventId: string;
  organizationId: string;
  kind: string;
  severity: string;
}

export interface IncidentUpdatedEvent extends BaseEventPayload {
  incidentId: string;
  eventId: string;
  organizationId: string;
  changes: Record<string, unknown>;
}

export interface IncidentResolvedEvent extends BaseEventPayload {
  incidentId: string;
  eventId: string;
  organizationId: string;
  /** Time in ms between createdAt and resolvedAt — useful for SLA. */
  durationMs: number;
}

export interface EmergencyBroadcastSentEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  /** Operator-supplied reason captured at send time. */
  reason: string;
  channels: string[];
  recipientCount: number;
  dispatchedCount: number;
}

/**
 * Phase O8 — Forensic trail for the per-event staff radio. We record
 * the message id, NOT the body — the body is private chat between
 * staff during a live event and shouldn't leak into long-term audit.
 * The id is enough to retrieve the message during an investigation.
 */
export interface StaffMessagePostedEvent extends BaseEventPayload {
  messageId: string;
  eventId: string;
  organizationId: string;
}

/**
 * Phase O9 — Snapshot of the post-event report at view time. The
 * payload carries the headline numbers (registered, checked-in,
 * gross, payout) so the audit row is informative without fetching
 * the live aggregation again at audit-display time. No PII.
 */
export interface PostEventReportGeneratedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  registered: number;
  checkedIn: number;
  grossAmount: number;
  payoutAmount: number;
}

/**
 * Phase O9 — Cohort CSV download. We capture the segment (`attended`
 * / `no_show` / `cancelled` / `all`) and the row count so the audit
 * answers "who pulled how many participant rows" without storing the
 * data itself. PII never enters the audit log.
 */
export interface CohortExportDownloadedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  segment: "attended" | "no_show" | "cancelled" | "all";
  rowCount: number;
}

/**
 * Phase O9 — Payout request (organizer-initiated). Distinct from
 * `payout.created` (the underlying ledger event) because the payout
 * service is shared with admin-driven payouts; this event tags the
 * organizer-initiated path so the audit table can show "Demande de
 * versement" instead of the generic creation row.
 */
export interface PayoutRequestedEvent extends BaseEventPayload {
  payoutId: string;
  eventId: string;
  organizationId: string;
  netAmount: number;
}

/**
 * Phase O10 — event was cloned from a starter template. Distinct from
 * `event.created` so the audit table can render the templating
 * origin (and so analytics can aggregate template usage).
 */
export interface EventClonedFromTemplateEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  templateId: string;
  sessionsAdded: number;
  commsBlueprintsAdded: number;
}

/**
 * Phase O10 — magic-link issued. The audit payload carries the
 * `tokenHash` (Firestore doc id of the persisted record) but NOT the
 * recipient email or the plaintext token — both are PII / credentials
 * that don't belong in the immutable audit log per CLAUDE.md. An
 * investigator with `magic_link:read` joins from the audit row's
 * `resourceId = tokenHash` to the `magicLinks/{tokenHash}` doc to
 * retrieve the recipient email when forensics actually need it.
 */
export interface MagicLinkIssuedEvent extends BaseEventPayload {
  tokenHash: string;
  role: "speaker" | "sponsor";
  resourceId: string;
  eventId: string;
  organizationId: string;
  expiresAt: string;
}

/**
 * Phase O10 — magic-link first use. The "actor" is the link itself
 * (`magic-link:<hash>`) since we don't have a user uid for an
 * unauthenticated portal visit.
 */
export interface MagicLinkUsedEvent extends BaseEventPayload {
  tokenHash: string;
  role: "speaker" | "sponsor";
  resourceId: string;
  eventId: string;
  organizationId: string;
}

/**
 * Phase O10 — magic-link revoked by an organizer.
 */
export interface MagicLinkRevokedEvent extends BaseEventPayload {
  tokenHash: string;
  role: "speaker" | "sponsor";
  resourceId: string;
  eventId: string;
  organizationId: string;
}

export type DomainEventName = keyof DomainEventMap;
