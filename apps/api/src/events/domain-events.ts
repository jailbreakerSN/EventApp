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
  accessZoneId?: string;
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

// ── Badge ────────────────────────────────────────────────────────────────────

export interface BadgeGeneratedEvent extends BaseEventPayload {
  badgeId: string;
  registrationId: string;
  eventId: string;
  userId: string;
}

// ─── Domain Event Map ────────────────────────────────────────────────────────
// Type-safe mapping of event names to their payloads.
// Adding a new event here gives compile-time safety across all emitters/listeners.

export interface DomainEventMap {
  "registration.created": RegistrationCreatedEvent;
  "registration.cancelled": RegistrationCancelledEvent;
  "registration.approved": RegistrationApprovedEvent;
  "checkin.completed": CheckInCompletedEvent;
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
}

export type DomainEventName = keyof DomainEventMap;
