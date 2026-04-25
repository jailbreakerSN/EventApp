---
title: Audit Actions Reference
status: shipped
last_updated: 2026-04-25
---

# Audit Actions Reference

> **Status: shipped** — 69 `AuditAction` enum values defined in `packages/shared-types/src/audit.types.ts`.

Every audit log entry carries one of these `action` values, identifying the business operation that was performed.

---

## Usage

```typescript
import { AuditActionSchema } from '@teranga/shared-types';

// Validate an incoming action string
const action = AuditActionSchema.parse('event.published'); // throws if invalid

// Use in audit listener
await auditLogsRepo.create({
  action: 'event.published',
  actorId: actor.uid,
  resourceType: 'event',
  resourceId: event.id,
  // ...
});
```

---

## Registration

| Action | Trigger |
|---|---|
| `registration.created` | Participant registers for an event |
| `registration.cancelled` | Registration cancelled by participant or organizer |
| `registration.approved` | Organizer approves a pending registration |
| `waitlist.promoted` | Waitlisted participant promoted to registered |
| `waitlist.promotion_failed` | Waitlist promotion failed (e.g. event became full) |

## Check-in

| Action | Trigger |
|---|---|
| `checkin.completed` | QR scan or manual check-in recorded |
| `checkin.bulk_synced` | Bulk offline check-in reconciliation submitted |
| `checkin.offline_sync.downloaded` | Staff app downloads encrypted offline sync snapshot |

## Event

| Action | Trigger |
|---|---|
| `event.created` | New event document created |
| `event.updated` | Event fields updated |
| `event.published` | Event moved to `published` status |
| `event.unpublished` | Published event moved back to draft |
| `event.cancelled` | Event cancelled |
| `event.archived` | Event soft-deleted / archived |
| `event.cloned` | Event duplicated via clone endpoint |
| `event.qr_key_rotated` | QR key kid rotated (invalidates existing QR codes) |

## Ticket Types

| Action | Trigger |
|---|---|
| `ticket_type.added` | Ticket type added to event |
| `ticket_type.updated` | Ticket type fields updated |
| `ticket_type.removed` | Ticket type removed from event |

## Badge

| Action | Trigger |
|---|---|
| `badge.generated` | Single badge generated for a registration |
| `badge.bulk_generated` | Badges bulk-generated for all registrations |

## Organization

| Action | Trigger |
|---|---|
| `organization.created` | New organization created |
| `organization.updated` | Organization fields updated |
| `organization.verified` | Super-admin verifies an organization |
| `organization.suspended` | Super-admin suspends an organization |

## Members & Invitations

| Action | Trigger |
|---|---|
| `member.added` | User added to organization |
| `member.removed` | User removed from organization |
| `member.role_changed` | Member's org role changed |
| `member.role_updated` | Member's org role updated (alias write path) |
| `invite.created` | Invitation token created |
| `invite.accepted` | Invitation accepted by recipient |
| `invite.declined` | Invitation declined |
| `invite.revoked` | Invitation revoked by organizer |

## Subscription & Plans

| Action | Trigger |
|---|---|
| `subscription.upgraded` | Organization plan upgraded |
| `subscription.downgraded` | Organization plan downgraded |
| `subscription.change_scheduled` | Future plan change scheduled |
| `subscription.scheduled_reverted` | Scheduled plan change cancelled |
| `subscription.period_rolled_over` | Subscription billing period renewed |
| `subscription.overridden` | Super-admin manually overrides org subscription |
| `plan.created` | New plan document added to catalog (Phase 5+) |
| `plan.updated` | Plan document updated |
| `plan.archived` | Plan archived from catalog |

## Payments

| Action | Trigger |
|---|---|
| `payment.initiated` | Payment flow started |
| `payment.succeeded` | Payment confirmed by provider webhook |
| `payment.failed` | Payment failed or rejected |
| `payment.refunded` | Refund issued |
| `receipt.generated` | Receipt document created for a successful payment |
| `payout.created` | Organizer payout record created |

## Sessions

| Action | Trigger |
|---|---|
| `session.created` | Conference session created |
| `session.updated` | Session fields updated |
| `session.deleted` | Session soft-deleted |

## Speakers & Sponsors

| Action | Trigger |
|---|---|
| `speaker.added` | Speaker added to event |
| `speaker.removed` | Speaker removed from event |
| `sponsor.added` | Sponsor added to event |
| `sponsor.removed` | Sponsor removed from event |
| `sponsor.lead_captured` | Participant lead captured at sponsor booth |

## Feed & Messaging

| Action | Trigger |
|---|---|
| `feed_post.created` | Social feed post created |
| `feed_post.deleted` | Feed post deleted |
| `feed_post.pinned` | Feed post pinned by organizer |
| `message.sent` | Direct message sent |
| `broadcast.sent` | Organizer broadcast dispatched |

## Venues

| Action | Trigger |
|---|---|
| `venue.created` | New venue profile created |
| `venue.updated` | Venue fields updated |
| `venue.approved` | Super-admin approves a venue listing |
| `venue.suspended` | Super-admin suspends a venue |
| `venue.reactivated` | Suspended venue reactivated |

## Users (admin operations)

| Action | Trigger |
|---|---|
| `user.role_changed` | Super-admin changes a user's global role |
| `user.suspended` | Super-admin suspends a user account |
| `user.activated` | Suspended user account reactivated |

---

## Adding a new action

1. Add the string to `AuditActionSchema` in `packages/shared-types/src/audit.types.ts`
2. Run `npm run types:build`
3. Add an entry to this reference table
4. Wire the domain event listener in `apps/api/src/events/listeners/audit.listener.ts`

See the full cookbook: [Adding a domain event](../../60-contributing/cookbooks/adding-a-domain-event.md)

---

## Querying the audit log

```typescript
// All actions on a specific event
await db.collection(COLLECTIONS.AUDIT_LOGS)
  .where('resourceId', '==', eventId)
  .where('resourceType', '==', 'event')
  .orderBy('timestamp', 'desc')
  .limit(50)
  .get();

// All actions by a specific actor
await db.collection(COLLECTIONS.AUDIT_LOGS)
  .where('actorId', '==', uid)
  .orderBy('timestamp', 'desc')
  .get();

// All check-in actions for an org
await db.collection(COLLECTIONS.AUDIT_LOGS)
  .where('organizationId', '==', orgId)
  .where('action', 'in', ['checkin.completed', 'checkin.bulk_synced'])
  .orderBy('timestamp', 'desc')
  .get();
```
