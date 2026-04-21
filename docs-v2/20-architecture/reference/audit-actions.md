# Audit Actions Reference

> **Status: shipped** — 83 `AuditAction` enum values defined in `packages/shared-types/src/audit.types.ts`.

Every audit log entry carries one of these `action` values, identifying the business operation that was performed.

---

## registration

| Action | Trigger |
|---|---|
| `registration.created` | Participant successfully registers for an event |
| `registration.cancelled` | Participant or organizer cancels a registration |
| `registration.approved` | Organizer approves a pending/waitlisted registration |
| `registration.rejected` | Organizer rejects a registration |
| `registration.waitlisted` | Registration placed on waitlist (requiresApproval=true) |
| `registration.promoted_from_waitlist` | Waitlisted registration auto-promoted on cancellation |
| `registration.exported` | Organizer exports registrations to CSV |

## check-in

| Action | Trigger |
|---|---|
| `checkin.completed` | Successful QR scan check-in |
| `checkin.failed` | Invalid/expired/forged QR code |
| `checkin.manual` | Manual check-in by name/email |
| `checkin.bulk_synced` | Offline bulk reconciliation uploaded |
| `checkin.offline_sync.downloaded` | Staff downloads offline sync snapshot |

## event

| Action | Trigger |
|---|---|
| `event.created` | New event created |
| `event.updated` | Event fields changed |
| `event.published` | Event status → published |
| `event.unpublished` | Event status → draft |
| `event.cancelled` | Event status → cancelled |
| `event.completed` | Event status → completed |
| `event.archived` | Event status → archived |
| `event.cloned` | Event cloned from existing |
| `event.scan_policy_changed` | Scan policy changed |
| `event.qr_key_rotated` | QR signing key (qrKid) rotated |

## badge

| Action | Trigger |
|---|---|
| `badge.generated` | Single badge PDF generated |
| `badge.bulk_generated` | Batch badge generation completed |
| `badge.sent` | Badge PDF sent to participant by email |
| `badge.failed` | Badge generation failed |

## organization

| Action | Trigger |
|---|---|
| `organization.created` | New organization created |
| `organization.updated` | Organization fields changed |
| `organization.verified` | KYB verified by super-admin |
| `organization.suspended` | Organization suspended by super-admin |
| `organization.reactivated` | Organization reactivated by super-admin |
| `organization.deleted` | Organization deleted (rare — soft delete) |

## member

| Action | Trigger |
|---|---|
| `member.added` | User added to organization |
| `member.removed` | User removed from organization |
| `member.role_changed` | Member's org role changed |

## invite

| Action | Trigger |
|---|---|
| `invite.created` | Org member invitation sent |
| `invite.accepted` | Invitation accepted by recipient |
| `invite.expired` | Invitation expired (7 days) |
| `invite.revoked` | Invitation revoked by organizer |

## subscription

| Action | Trigger |
|---|---|
| `subscription.created` | Subscription initialized (on org creation) |
| `subscription.upgraded` | Plan upgraded |
| `subscription.downgraded` | Plan downgraded (immediate) |
| `subscription.change_scheduled` | Downgrade queued for period end |
| `subscription.scheduled_reverted` | Scheduled change cancelled |
| `subscription.cancelled` | Subscription cancelled → reverts to free |
| `subscription.period_rolled_over` | Monthly/annual period advanced |
| `subscription.past_due` | Payment failed, subscription past due |
| `subscription.reinstated` | Past-due subscription reinstated |

## plan

| Action | Trigger |
|---|---|
| `plan.created` | Super-admin creates a plan in catalog |
| `plan.updated` | Super-admin updates a plan |
| `plan.archived` | Super-admin archives a plan |

## payment

| Action | Trigger |
|---|---|
| `payment.initiated` | Payment flow started |
| `payment.succeeded` | Provider confirms successful payment |
| `payment.failed` | Payment failed |
| `payment.expired` | Payment timeout (1 hour) |
| `payment.refunded` | Payment refunded |

## user

| Action | Trigger |
|---|---|
| `user.created` | Firebase Auth user created (via Cloud Functions trigger) |
| `user.updated` | User profile updated |
| `user.deleted` | User soft-deleted |
| `user.roles_changed` | Super-admin changes user roles |
| `user.suspended` | Super-admin suspends user |
| `user.reactivated` | Super-admin reactivates user |
| `user.email_verified` | User verifies email address |

## venue

| Action | Trigger |
|---|---|
| `venue.created` | New venue listing created |
| `venue.updated` | Venue details updated |
| `venue.approved` | Super-admin approves venue |
| `venue.suspended` | Super-admin suspends venue |

## feed

| Action | Trigger |
|---|---|
| `feed.post_created` | Organizer/speaker creates a feed post |
| `feed.post_deleted` | Post deleted (soft) |
| `feed.post_pinned` | Post pinned by organizer |
| `feed.comment_created` | Participant adds comment |
| `feed.comment_moderated` | Comment removed by organizer |

## session

| Action | Trigger |
|---|---|
| `session.created` | Agenda session created |
| `session.updated` | Session updated |
| `session.deleted` | Session soft-deleted |

## sponsor

| Action | Trigger |
|---|---|
| `sponsor.created` | Sponsor added to event |
| `sponsor.lead_captured` | Participant badge scanned by sponsor |

## notification

| Action | Trigger |
|---|---|
| `notification.broadcast_sent` | Broadcast communication sent |
| `notification.broadcast_scheduled` | Broadcast scheduled for future |

## promo_code

| Action | Trigger |
|---|---|
| `promo_code.created` | Promo code created |
| `promo_code.deactivated` | Promo code deactivated |
| `promo_code.applied` | Promo code used at checkout |

---

## Querying audit logs

```typescript
// Get all audit logs for an organization
GET /v1/admin/audit?organizationId=<orgId>&limit=50

// Get audit logs for a specific event
GET /v1/admin/audit?eventId=<eventId>

// Get audit logs for a specific actor
GET /v1/admin/audit?actorId=<uid>
```

Audit logs are stored in the `audit_logs` Firestore collection. They are indexed by `organizationId`, `eventId`, `actorId`, and `timestamp`.
