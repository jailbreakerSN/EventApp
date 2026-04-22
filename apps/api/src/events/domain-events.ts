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

export interface EventClonedEvent extends BaseEventPayload {
  sourceEventId: string;
  newEventId: string;
  organizationId: string;
}

export interface WaitlistPromotedEvent extends BaseEventPayload {
  registrationId: string;
  eventId: string;
  userId: string;
  organizationId: string;
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
  /** The registration whose cancel triggered the promotion attempt. */
  cancelledRegistrationId: string;
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

export interface MemberRoleUpdatedEvent extends BaseEventPayload {
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

export interface PaymentRefundedEvent extends BaseEventPayload {
  paymentId: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  amount: number;
  reason?: string;
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

export interface NotificationSettingUpdatedEvent extends BaseEventPayload {
  key: string;
  enabled: boolean;
  channels: ("email" | "sms" | "push" | "in_app")[];
  hasSubjectOverride: boolean;
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
  "event.qr_key_rotated": EventQrKeyRotatedEvent;
  "event.published": EventPublishedEvent;
  "event.unpublished": EventUnpublishedEvent;
  "event.cancelled": EventCancelledEvent;
  "event.archived": EventArchivedEvent;
  "event.cloned": EventClonedEvent;
  "waitlist.promoted": WaitlistPromotedEvent;
  "waitlist.promotion_failed": WaitlistPromotionFailedEvent;
  "ticket_type.added": TicketTypeAddedEvent;
  "ticket_type.updated": TicketTypeUpdatedEvent;
  "ticket_type.removed": TicketTypeRemovedEvent;
  "organization.created": OrganizationCreatedEvent;
  "organization.updated": OrganizationUpdatedEvent;
  "member.added": MemberAddedEvent;
  "member.removed": MemberRemovedEvent;
  "member.role_updated": MemberRoleUpdatedEvent;
  "badge.generated": BadgeGeneratedEvent;
  "badge.bulk_generated": BadgeBulkGeneratedEvent;
  "payment.initiated": PaymentInitiatedEvent;
  "payment.succeeded": PaymentSucceededEvent;
  "payment.failed": PaymentFailedEvent;
  "payment.refunded": PaymentRefundedEvent;
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
  // Notification dispatcher (Phase 1)
  "notification.sent": NotificationSentEvent;
  "notification.suppressed": NotificationSuppressedEvent;
  "notification.setting_updated": NotificationSettingUpdatedEvent;
  // User lifecycle (Phase 2)
  "user.created": UserCreatedEvent;
  "user.password_changed": UserPasswordChangedEvent;
  "user.email_changed": UserEmailChangedEvent;
  // Subscription billing (Phase 2)
  "subscription.past_due": SubscriptionPastDueEvent;
  "subscription.cancelled": SubscriptionCancelledEvent;
}

export type DomainEventName = keyof DomainEventMap;
