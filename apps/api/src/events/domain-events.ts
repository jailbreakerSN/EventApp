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
  userId: string;
}

// ── Broadcast ──────────────────────────────────────────────────────────────

export interface BroadcastSentEvent extends BaseEventPayload {
  broadcastId: string;
  eventId: string;
  organizationId: string;
  channels: string[];
  recipientCount: number;
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
  "access_zone.added": AccessZoneAddedEvent;
  "access_zone.updated": AccessZoneUpdatedEvent;
  "access_zone.removed": AccessZoneRemovedEvent;
  "event.created": EventCreatedEvent;
  "event.updated": EventUpdatedEvent;
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
}

export type DomainEventName = keyof DomainEventMap;
