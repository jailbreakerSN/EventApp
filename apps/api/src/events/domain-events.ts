import {
  type Registration,
  type Event,
  type Organization,
} from "@teranga/shared-types";

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

export interface WaitlistPromotedEvent extends BaseEventPayload {
  registrationId: string;
  eventId: string;
  userId: string;
  organizationId: string;
}

// ── Organization ─────────────────────────────────────────────────────────────

export interface OrganizationCreatedEvent extends BaseEventPayload {
  organization: Organization;
}

export interface MemberAddedEvent extends BaseEventPayload {
  organizationId: string;
  memberId: string;
}

export interface MemberRemovedEvent extends BaseEventPayload {
  organizationId: string;
  memberId: string;
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
  "waitlist.promoted": WaitlistPromotedEvent;
  "ticket_type.added": TicketTypeAddedEvent;
  "ticket_type.updated": TicketTypeUpdatedEvent;
  "ticket_type.removed": TicketTypeRemovedEvent;
  "organization.created": OrganizationCreatedEvent;
  "member.added": MemberAddedEvent;
  "member.removed": MemberRemovedEvent;
  "badge.generated": BadgeGeneratedEvent;
  "payment.initiated": PaymentInitiatedEvent;
  "payment.succeeded": PaymentSucceededEvent;
  "payment.failed": PaymentFailedEvent;
  "payment.refunded": PaymentRefundedEvent;
  "broadcast.sent": BroadcastSentEvent;
  "speaker.added": SpeakerAddedEvent;
  "speaker.removed": SpeakerRemovedEvent;
  "sponsor.added": SponsorAddedEvent;
  "sponsor.lead_captured": SponsorLeadCapturedEvent;
  "promo_code.created": PromoCodeCreatedEvent;
  "promo_code.used": PromoCodeUsedEvent;
}

export type DomainEventName = keyof DomainEventMap;
