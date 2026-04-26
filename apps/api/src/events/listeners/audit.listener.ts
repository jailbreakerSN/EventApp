import { eventBus } from "../event-bus";
import { auditService } from "@/services/audit.service";

// ─── Audit Listener ─────────────────────────────────────────────────────────
// Subscribes to ALL domain events and writes structured audit log entries.
// Fire-and-forget — errors are caught inside auditService, never propagated.

export function registerAuditListeners(): void {
  // ── Registration Events ─────────────────────────────────────────────────

  eventBus.on("registration.created", async (payload) => {
    await auditService.log({
      action: "registration.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "registration",
      resourceId: payload.registration.id,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        userId: payload.registration.userId,
        ticketTypeId: payload.registration.ticketTypeId,
        status: payload.registration.status,
      },
    });
  });

  eventBus.on("registration.cancelled", async (payload) => {
    await auditService.log({
      action: "registration.cancelled",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "registration",
      resourceId: payload.registrationId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        userId: payload.userId,
      },
    });
  });

  eventBus.on("registration.approved", async (payload) => {
    await auditService.log({
      action: "registration.approved",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "registration",
      resourceId: payload.registrationId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        userId: payload.userId,
      },
    });
  });

  // ── Check-in Events ─────────────────────────────────────────────────────

  eventBus.on("checkin.completed", async (payload) => {
    await auditService.log({
      action: "checkin.completed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "registration",
      resourceId: payload.registrationId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        participantId: payload.participantId,
        staffId: payload.staffId,
        accessZoneId: payload.accessZoneId ?? null,
        source: payload.source ?? "live",
        // Device attestation — landed in the audit trail for post-event
        // forensics even if the UI doesn't surface them yet (Sprint C 4.3).
        scannerDeviceId: payload.scannerDeviceId ?? null,
        scannerNonce: payload.scannerNonce ?? null,
        clientScannedAt: payload.clientScannedAt ?? null,
        serverConfirmedAt: payload.checkedInAt ?? payload.timestamp,
      },
    });
  });

  // Aggregate fire when staff reconcile a batch of offline scans. The
  // individual `checkin.completed` records already landed for each item;
  // this one captures the batch envelope (counts + staff id) so a
  // security dashboard can flag "staff X reconciled 1 200 scans at once
  // from a device the api hasn't seen before".
  eventBus.on("checkin.bulk_synced", async (payload) => {
    await auditService.log({
      action: "checkin.bulk_synced",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        processed: payload.processed,
        succeeded: payload.succeeded,
        failed: payload.failed,
      },
    });
  });

  eventBus.on("checkin.offline_sync.downloaded", async (payload) => {
    await auditService.log({
      action: "checkin.offline_sync.downloaded",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        staffId: payload.staffId,
        scannerDeviceId: payload.scannerDeviceId ?? null,
        encrypted: payload.encrypted,
        itemCount: payload.itemCount,
        ttlAt: payload.ttlAt,
      },
    });
  });

  // ── Event Lifecycle ─────────────────────────────────────────────────────

  eventBus.on("event.created", async (payload) => {
    await auditService.log({
      action: "event.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.event.id,
      eventId: payload.event.id,
      organizationId: payload.organizationId,
      details: {
        title: payload.event.title,
      },
    });
  });

  eventBus.on("event.updated", async (payload) => {
    await auditService.log({
      action: "event.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        changes: payload.changes,
      },
    });
  });

  // QR signing-key rotation lives on its own action so post-event
  // forensics can ask "who rotated keys on this event" without parsing
  // a `details.changes.action` sub-field off the generic `event.updated`
  // stream.
  eventBus.on("event.qr_key_rotated", async (payload) => {
    await auditService.log({
      action: "event.qr_key_rotated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        newKid: payload.newKid,
        previousKid: payload.previousKid,
      },
    });
  });

  eventBus.on("event.published", async (payload) => {
    await auditService.log({
      action: "event.published",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.event.id,
      eventId: payload.event.id,
      organizationId: payload.organizationId,
      details: {
        title: payload.event.title,
      },
    });
  });

  eventBus.on("event.unpublished", async (payload) => {
    await auditService.log({
      action: "event.unpublished",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {},
    });
  });

  eventBus.on("event.cancelled", async (payload) => {
    await auditService.log({
      action: "event.cancelled",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {},
    });
  });

  eventBus.on("event.archived", async (payload) => {
    await auditService.log({
      action: "event.archived",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {},
    });
  });

  // T2.2 closure — admin "Restaurer" undo. Emitted when an archived
  // event is brought back into draft within the 30-day window.
  eventBus.on("event.restored", async (payload) => {
    await auditService.log({
      action: "event.restored",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {},
    });
  });

  // `event.cloned` was emitted by `EventService.clone()` but had no audit
  // mapping — cloning an event left no trail. The new clone carries a
  // fresh `qrKid`, so rotation metadata forensics also depended on this.
  eventBus.on("event.cloned", async (payload) => {
    await auditService.log({
      action: "event.cloned",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.newEventId,
      eventId: payload.newEventId,
      organizationId: payload.organizationId,
      details: {
        sourceEventId: payload.sourceEventId,
      },
    });
  });

  // ── Recurring events (Phase 7+ item #B1) ────────────────────────────────

  eventBus.on("event.series_created", async (payload) => {
    await auditService.log({
      action: "event.series_created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.parentEventId,
      eventId: payload.parentEventId,
      organizationId: payload.organizationId,
      details: { occurrenceCount: payload.occurrenceCount },
    });
  });

  eventBus.on("event.series_published", async (payload) => {
    await auditService.log({
      action: "event.series_published",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.parentEventId,
      eventId: payload.parentEventId,
      organizationId: payload.organizationId,
      details: { publishedCount: payload.publishedCount },
    });
  });

  // Sprint-4 T3.2 closure — scheduled admin operations CRUD.
  eventBus.on("scheduled_admin_op.created", async (payload) => {
    await auditService.log({
      action: "scheduled_admin_op.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "scheduled_admin_op",
      resourceId: payload.opId,
      eventId: null,
      organizationId: null,
      details: { jobKey: payload.jobKey, cron: payload.cron },
    });
  });
  eventBus.on("scheduled_admin_op.updated", async (payload) => {
    await auditService.log({
      action: "scheduled_admin_op.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "scheduled_admin_op",
      resourceId: payload.opId,
      eventId: null,
      organizationId: null,
      details: { changes: payload.changes },
    });
  });
  eventBus.on("scheduled_admin_op.deleted", async (payload) => {
    await auditService.log({
      action: "scheduled_admin_op.deleted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "scheduled_admin_op",
      resourceId: payload.opId,
      eventId: null,
      organizationId: null,
      details: {},
    });
  });

  // Sprint-2 S1 closure — bulk cancel of an entire series.
  eventBus.on("event.series_cancelled", async (payload) => {
    await auditService.log({
      action: "event.series_cancelled",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.parentEventId,
      eventId: payload.parentEventId,
      organizationId: payload.organizationId,
      details: {
        cancelledCount: payload.cancelledCount,
        cancelledChildIds: payload.cancelledChildIds,
      },
    });
  });

  // ── Organization Events ─────────────────────────────────────────────────

  eventBus.on("organization.created", async (payload) => {
    await auditService.log({
      action: "organization.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "organization",
      resourceId: payload.organization.id,
      eventId: null,
      organizationId: payload.organization.id,
      details: {
        name: payload.organization.name,
        plan: payload.organization.plan,
      },
    });
  });

  eventBus.on("member.added", async (payload) => {
    await auditService.log({
      action: "member.added",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "organization",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        memberId: payload.memberId,
      },
    });
  });

  eventBus.on("member.removed", async (payload) => {
    await auditService.log({
      action: "member.removed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "organization",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        memberId: payload.memberId,
      },
    });
  });

  // ── Ticket Type Events ──────────────────────────────────────────────────

  eventBus.on("ticket_type.added", async (payload) => {
    await auditService.log({
      action: "ticket_type.added",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        ticketTypeId: payload.ticketTypeId,
        ticketTypeName: payload.ticketTypeName,
      },
    });
  });

  eventBus.on("ticket_type.updated", async (payload) => {
    await auditService.log({
      action: "ticket_type.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        ticketTypeId: payload.ticketTypeId,
        changes: payload.changes,
      },
    });
  });

  eventBus.on("ticket_type.removed", async (payload) => {
    await auditService.log({
      action: "ticket_type.removed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        ticketTypeId: payload.ticketTypeId,
        ticketTypeName: payload.ticketTypeName,
      },
    });
  });

  // ── Badge Events ────────────────────────────────────────────────────────

  eventBus.on("badge.generated", async (payload) => {
    await auditService.log({
      action: "badge.generated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "badge",
      resourceId: payload.badgeId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        registrationId: payload.registrationId,
        userId: payload.userId,
      },
    });
  });

  // Aggregate for `BadgeService.bulkGenerate`. Individual per-badge
  // events would flood the trail on a 500-participant event; the
  // summary carries enough to answer "who bulk-generated badges on
  // this event, when, how many".
  eventBus.on("badge.bulk_generated", async (payload) => {
    await auditService.log({
      action: "badge.bulk_generated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        templateId: payload.templateId,
        created: payload.created,
      },
    });
  });

  eventBus.on("waitlist.promoted", async (payload) => {
    await auditService.log({
      action: "waitlist.promoted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "registration",
      resourceId: payload.registrationId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        userId: payload.userId,
        // F2 — denormalise the bulk-path discriminator so audit
        // dashboards can filter out per-entry rows when aggregating
        // alongside the parallel `waitlist.bulk_promoted` summary
        // (avoids double-counting). Absent ⇒ single-cancel path.
        ...(payload.bulkPromotion ? { bulkPromotion: true } : {}),
      },
    });
  });

  // Promotion attempt ran but failed AFTER the cancel committed. We
  // audit it so operators can see via /admin/audit that a slot is
  // stuck in limbo — the event has a registered count 1 too low
  // relative to what the cancel logic implied. No auto-retry is wired
  // yet; this is pure visibility.
  eventBus.on("waitlist.promotion_failed", async (payload) => {
    await auditService.log({
      action: "waitlist.promotion_failed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        // Only persist `cancelledRegistrationId` when present — the
        // retry-exhaustion path (B2 follow-up F2) deliberately omits
        // it so future queries that join the field back to
        // `registrations/{id}` aren't poisoned by sentinel strings.
        ...(payload.cancelledRegistrationId
          ? { cancelledRegistrationId: payload.cancelledRegistrationId }
          : {}),
        // B2 — denormalise the tier scope onto the audit row so
        // operators can answer "which tier is stuck" without joining
        // back to the cancelled registration.
        ...(payload.ticketTypeId ? { ticketTypeId: payload.ticketTypeId } : {}),
        // F2 — discriminator: `cancel_driven` (cancel triggered),
        // `retry_exhausted` (5 race-losses), `bulk_entry` (per-entry
        // exception during `bulkPromoteWaitlisted`).
        ...(payload.failureKind ? { failureKind: payload.failureKind } : {}),
        reason: payload.reason,
      },
    });
  });

  // B2 follow-up — aggregate audit row for bulk-promote runs. Carries
  // the totals + tier scope so an operator dashboard can answer
  // "which organiser ran a 25-person promotion last week" without
  // counting per-entry `waitlist.promoted` rows by `requestId`.
  eventBus.on("waitlist.bulk_promoted", async (payload) => {
    await auditService.log({
      action: "waitlist.bulk_promoted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        promotedCount: payload.promotedCount,
        skipped: payload.skipped,
        ...(payload.ticketTypeId ? { ticketTypeId: payload.ticketTypeId } : {}),
      },
    });
  });

  // ── Organization Updated ───────────────────────────────────────────────

  eventBus.on("organization.updated", async (payload) => {
    await auditService.log({
      action: "organization.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "organization",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: { changes: payload.changes },
    });
  });

  // ── Speaker Events ─────────────────────────────────────────────────────

  eventBus.on("speaker.added", async (payload) => {
    await auditService.log({
      action: "speaker.added",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "speaker",
      resourceId: payload.speakerId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { name: payload.name },
    });
  });

  eventBus.on("speaker.removed", async (payload) => {
    await auditService.log({
      action: "speaker.removed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "speaker",
      resourceId: payload.speakerId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {},
    });
  });

  // ── Sponsor Events ────────────────────────────────────────────────────

  eventBus.on("sponsor.added", async (payload) => {
    await auditService.log({
      action: "sponsor.added",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "sponsor",
      resourceId: payload.sponsorId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { companyName: payload.companyName, tier: payload.tier },
    });
  });

  eventBus.on("sponsor.lead_captured", async (payload) => {
    await auditService.log({
      action: "sponsor.lead_captured",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "sponsor_lead",
      resourceId: payload.leadId,
      eventId: payload.eventId,
      organizationId: null,
      details: { sponsorId: payload.sponsorId, participantId: payload.participantId },
    });
  });

  // ── Venue Events ───────────────────────────────────────────────────────

  eventBus.on("venue.created", async (payload) => {
    await auditService.log({
      action: "venue.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "venue",
      resourceId: payload.venueId,
      eventId: null,
      organizationId: payload.hostOrganizationId ?? null,
      details: { name: payload.name },
    });
  });

  eventBus.on("venue.updated", async (payload) => {
    await auditService.log({
      action: "venue.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "venue",
      resourceId: payload.venueId,
      eventId: null,
      organizationId: null,
      details: { changes: payload.changes },
    });
  });

  eventBus.on("venue.approved", async (payload) => {
    await auditService.log({
      action: "venue.approved",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "venue",
      resourceId: payload.venueId,
      eventId: null,
      organizationId: null,
      details: { name: payload.name },
    });
  });

  eventBus.on("venue.suspended", async (payload) => {
    await auditService.log({
      action: "venue.suspended",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "venue",
      resourceId: payload.venueId,
      eventId: null,
      organizationId: null,
      details: { name: payload.name },
    });
  });

  eventBus.on("venue.reactivated", async (payload) => {
    await auditService.log({
      action: "venue.reactivated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "venue",
      resourceId: payload.venueId,
      eventId: null,
      organizationId: null,
      details: { name: payload.name },
    });
  });

  // ── Broadcast Events ──────────────────────────────────────────────────

  eventBus.on("broadcast.sent", async (payload) => {
    await auditService.log({
      action: "broadcast.sent",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "broadcast",
      resourceId: payload.broadcastId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { channels: payload.channels, recipientCount: payload.recipientCount },
    });
  });

  // ── Newsletter Events ─────────────────────────────────────────────────
  // Platform-wide (no event / org scope); both eventId and organizationId
  // are null because the newsletter isn't tied to any one tenant.

  eventBus.on("newsletter.subscriber_created", async (payload) => {
    await auditService.log({
      action: "newsletter.subscriber_created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "newsletter_subscriber",
      resourceId: payload.subscriberId,
      eventId: null,
      organizationId: null,
      details: { email: payload.email, source: payload.source },
    });
  });

  eventBus.on("newsletter.subscriber_confirmed", async (payload) => {
    await auditService.log({
      action: "newsletter.subscriber_confirmed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "newsletter_subscriber",
      resourceId: payload.subscriberId,
      eventId: null,
      organizationId: null,
      // GDPR/CASL: the confirmation timestamp is the legally relevant
      // "when did they consent" record. Email retained alongside so the
      // audit log alone is a valid consent trail.
      details: { email: payload.email, confirmedAt: payload.confirmedAt },
    });
  });

  eventBus.on("newsletter.sent", async (payload) => {
    await auditService.log({
      action: "newsletter.sent",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "newsletter_broadcast",
      resourceId: payload.broadcastId,
      eventId: null,
      organizationId: null,
      details: { subject: payload.subject, segmentId: payload.segmentId },
    });
  });

  // ── Notification-preference unsubscribe (Phase 3c.4) ──────────────────
  // Triggered by a subscriber clicking the List-Unsubscribe link or Gmail
  // firing the RFC 8058 one-click POST. Recorded against the user's own
  // userId as both `actorId` and `resourceId` — this is a self-service
  // action, no admin involvement.

  eventBus.on("notification.unsubscribed", async (payload) => {
    await auditService.log({
      action: "notification.unsubscribed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification_preference",
      resourceId: payload.userId,
      eventId: null,
      organizationId: null,
      details: { category: payload.category, source: payload.source },
    });
  });

  // ── Notification Resubscribed (Phase 2.5) ─────────────────────────────
  // Mirror of notification.unsubscribed: user flips a per-key opt-out
  // back to enabled from the history page.

  eventBus.on("notification.resubscribed", async (payload) => {
    await auditService.log({
      action: "notification.resubscribed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification_preference",
      resourceId: payload.userId,
      eventId: null,
      organizationId: null,
      details: { key: payload.key },
    });
  });

  // ── Sponsor Removed ───────────────────────────────────────────────────

  eventBus.on("sponsor.removed", async (payload) => {
    await auditService.log({
      action: "sponsor.removed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "sponsor",
      resourceId: payload.sponsorId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {},
    });
  });

  // ── Feed Post Events ──────────────────────────────────────────────────

  eventBus.on("feed_post.created", async (payload) => {
    await auditService.log({
      action: "feed_post.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "feed_post",
      resourceId: payload.postId,
      eventId: payload.eventId,
      organizationId: null,
      details: { authorId: payload.authorId, isAnnouncement: payload.isAnnouncement },
    });
  });

  eventBus.on("feed_post.deleted", async (payload) => {
    await auditService.log({
      action: "feed_post.deleted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "feed_post",
      resourceId: payload.postId,
      eventId: payload.eventId,
      organizationId: null,
      details: {},
    });
  });

  eventBus.on("feed_post.pinned", async (payload) => {
    await auditService.log({
      action: "feed_post.pinned",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "feed_post",
      resourceId: payload.postId,
      eventId: payload.eventId,
      organizationId: null,
      details: { pinned: payload.pinned },
    });
  });

  // ── Session Events ────────────────────────────────────────────────────

  eventBus.on("session.created", async (payload) => {
    await auditService.log({
      action: "session.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "session",
      resourceId: payload.sessionId,
      eventId: payload.eventId,
      organizationId: null,
      details: { title: payload.title },
    });
  });

  eventBus.on("session.updated", async (payload) => {
    await auditService.log({
      action: "session.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "session",
      resourceId: payload.sessionId,
      eventId: payload.eventId,
      organizationId: null,
      details: { changes: payload.changes },
    });
  });

  eventBus.on("session.deleted", async (payload) => {
    await auditService.log({
      action: "session.deleted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "session",
      resourceId: payload.sessionId,
      eventId: payload.eventId,
      organizationId: null,
      details: { title: payload.title },
    });
  });

  // ── Message Events ────────────────────────────────────────────────────

  eventBus.on("message.sent", async (payload) => {
    await auditService.log({
      action: "message.sent",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "message",
      resourceId: payload.messageId,
      eventId: null,
      organizationId: null,
      details: { conversationId: payload.conversationId, recipientId: payload.recipientId },
    });
  });

  // ── Invite Events ─────────────────────────────────────────────────────

  eventBus.on("invite.created", async (payload) => {
    await auditService.log({
      action: "invite.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "invite",
      resourceId: payload.inviteId,
      eventId: null,
      organizationId: payload.organizationId,
      details: { email: payload.email, role: payload.role },
    });
  });

  eventBus.on("invite.accepted", async (payload) => {
    await auditService.log({
      action: "invite.accepted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "invite",
      resourceId: payload.inviteId,
      eventId: null,
      organizationId: payload.organizationId,
      details: { userId: payload.userId },
    });
  });

  eventBus.on("invite.declined", async (payload) => {
    await auditService.log({
      action: "invite.declined",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "invite",
      resourceId: payload.inviteId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {},
    });
  });

  eventBus.on("invite.revoked", async (payload) => {
    await auditService.log({
      action: "invite.revoked",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "invite",
      resourceId: payload.inviteId,
      eventId: null,
      organizationId: payload.organizationId,
      details: { email: payload.email },
    });
  });

  // ── Payout Events ─────────────────────────────────────────────────────

  eventBus.on("payout.created", async (payload) => {
    await auditService.log({
      action: "payout.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payout",
      resourceId: payload.payoutId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { netAmount: payload.netAmount },
    });
  });

  // ── Admin Events ───────────────────────────────────────────────────────

  eventBus.on("user.role_changed", async (payload) => {
    await auditService.log({
      action: "user.role_changed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "user",
      resourceId: payload.targetUserId,
      eventId: null,
      organizationId: null,
      details: { oldRoles: payload.oldRoles, newRoles: payload.newRoles },
    });
  });

  eventBus.on("user.status_changed", async (payload) => {
    await auditService.log({
      action: payload.isActive ? "user.activated" : "user.suspended",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "user",
      resourceId: payload.targetUserId,
      eventId: null,
      organizationId: null,
      details: { isActive: payload.isActive },
    });
  });

  eventBus.on("organization.verified", async (payload) => {
    await auditService.log({
      action: "organization.verified",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "organization",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {},
    });
  });

  eventBus.on("organization.status_changed", async (payload) => {
    await auditService.log({
      action: payload.isActive ? "organization.verified" : "organization.suspended",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "organization",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: { isActive: payload.isActive },
    });
  });

  // ── Plan Catalog Events ────────────────────────────────────────────────

  eventBus.on("plan.created", async (payload) => {
    await auditService.log({
      action: "plan.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "plan",
      resourceId: payload.planId,
      eventId: null,
      organizationId: null,
      details: { key: payload.key },
    });
  });

  eventBus.on("plan.updated", async (payload) => {
    await auditService.log({
      action: "plan.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "plan",
      resourceId: payload.planId,
      eventId: null,
      organizationId: null,
      details: { key: payload.key, changes: payload.changes },
    });
  });

  eventBus.on("plan.archived", async (payload) => {
    await auditService.log({
      action: "plan.archived",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "plan",
      resourceId: payload.planId,
      eventId: null,
      organizationId: null,
      details: { key: payload.key },
    });
  });

  // ── Plan Coupons (Phase 7+ item #7) ────────────────────────────────────
  // Super-admin-only surface; all coupons are platform-scoped so
  // organizationId stays null on the audit row. Redemptions are audited
  // via the CouponRedemption doc itself.

  eventBus.on("plan_coupon.created", async (payload) => {
    await auditService.log({
      action: "plan_coupon.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "plan_coupon",
      resourceId: payload.couponId,
      eventId: null,
      organizationId: null,
      details: { code: payload.code },
    });
  });

  eventBus.on("plan_coupon.updated", async (payload) => {
    await auditService.log({
      action: "plan_coupon.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "plan_coupon",
      resourceId: payload.couponId,
      eventId: null,
      organizationId: null,
      details: { changes: payload.changes },
    });
  });

  eventBus.on("plan_coupon.archived", async (payload) => {
    await auditService.log({
      action: "plan_coupon.archived",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "plan_coupon",
      resourceId: payload.couponId,
      eventId: null,
      organizationId: null,
      details: {},
    });
  });

  // ── Subscription lifecycle (Phase 4c) ──────────────────────────────────

  eventBus.on("subscription.change_scheduled", async (payload) => {
    await auditService.log({
      action: "subscription.change_scheduled",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "subscription",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        fromPlan: payload.fromPlan,
        toPlan: payload.toPlan,
        effectiveAt: payload.effectiveAt,
        reason: payload.reason,
      },
    });
  });

  eventBus.on("subscription.scheduled_reverted", async (payload) => {
    await auditService.log({
      action: "subscription.scheduled_reverted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "subscription",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        revertedToPlan: payload.revertedToPlan,
        revertedEffectiveAt: payload.revertedEffectiveAt,
      },
    });
  });

  eventBus.on("subscription.period_rolled_over", async (payload) => {
    await auditService.log({
      action: "subscription.period_rolled_over",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "subscription",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        fromPlan: payload.fromPlan,
        toPlan: payload.toPlan,
        reason: payload.reason,
      },
    });
  });

  eventBus.on("subscription.upgraded", async (payload) => {
    await auditService.log({
      action: "subscription.upgraded",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "subscription",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        previousPlan: payload.previousPlan,
        newPlan: payload.newPlan,
        // Phase 7+ item #7 — denorm the applied coupon (if any) onto the
        // audit row so "which upgrades used coupon X" queries don't need
        // a join against couponRedemptions. Absent = no coupon.
        ...(payload.appliedCoupon
          ? {
              appliedCouponCode: payload.appliedCoupon.code,
              appliedCouponDiscountXof: payload.appliedCoupon.discountXof,
            }
          : {}),
      },
    });
  });

  eventBus.on("subscription.downgraded", async (payload) => {
    await auditService.log({
      action: "subscription.downgraded",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "subscription",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        previousPlan: payload.previousPlan,
        newPlan: payload.newPlan,
      },
    });
  });

  // ── Payment lifecycle ──────────────────────────────────────────────────
  // Every payment state transition is audited so the finance surface has a
  // full trail of intent → outcome (initiated, succeeded, failed, refunded).

  eventBus.on("payment.initiated", async (payload) => {
    await auditService.log({
      action: "payment.initiated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payment",
      resourceId: payload.paymentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        registrationId: payload.registrationId,
        amount: payload.amount,
        method: payload.method,
      },
    });
  });

  eventBus.on("payment.succeeded", async (payload) => {
    await auditService.log({
      action: "payment.succeeded",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payment",
      resourceId: payload.paymentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        registrationId: payload.registrationId,
        amount: payload.amount,
      },
    });
  });

  eventBus.on("payment.failed", async (payload) => {
    await auditService.log({
      action: "payment.failed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payment",
      resourceId: payload.paymentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        registrationId: payload.registrationId,
      },
    });
  });

  // Phase 2 follow-up — explicit expiration distinct from `payment.failed`.
  // Two trigger paths converge on this audit row:
  //   - reason="timeout"        → auto-expirer cron (>TTL)
  //   - reason="user_cancelled" → user-initiated cancel of pending_payment
  // The dispatcher renders different copy per reason; the audit row
  // keeps both branches queryable from /admin/audit.
  eventBus.on("payment.expired", async (payload) => {
    await auditService.log({
      action: "payment.expired",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payment",
      resourceId: payload.paymentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        registrationId: payload.registrationId,
        reason: payload.reason,
      },
    });
  });

  eventBus.on("payment.refunded", async (payload) => {
    await auditService.log({
      action: "payment.refunded",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payment",
      resourceId: payload.paymentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        registrationId: payload.registrationId,
        amount: payload.amount,
        reason: payload.reason ?? null,
      },
    });
  });

  // ── Phase-1 audit follow-up — refund.issued + refund.failed ──
  // These events are emitted alongside `payment.refunded` (success
  // path) and ON the failure path. Without dedicated audit handlers,
  // the failure path leaves zero audit rows: a provider rejection
  // (Wave returned `insufficient_funds`, OM said `manual refund
  // required`) silently disappears from the trail. The dedicated
  // rows let post-incident analysis distinguish:
  //   - `payment.refunded`: domain state transition (the canonical
  //     audit row for the refund).
  //   - `refund.issued`:    customer-facing notification dispatch
  //     hint — the user's email/SMS template was triggered.
  //   - `refund.failed`:    money touched the provider but the
  //     refund itself didn't land. THIS is the row ops needs when
  //     reconciling after a provider outage.
  eventBus.on("refund.issued", async (payload) => {
    await auditService.log({
      action: "refund.issued",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payment",
      resourceId: payload.paymentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        registrationId: payload.registrationId,
        amount: payload.amount,
        reason: payload.reason ?? null,
      },
    });
  });

  eventBus.on("refund.failed", async (payload) => {
    await auditService.log({
      action: "refund.failed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payment",
      resourceId: payload.paymentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        registrationId: payload.registrationId,
        amount: payload.amount,
        failureReason: payload.failureReason,
      },
    });
  });

  // ── Phase 2 / T-PD-03 — payment.tampering_attempted ──
  // Fires when handleWebhook rejects an IPN whose anti-tampering
  // invariants failed. The signature verified (so the request came
  // from the provider) BUT the payload's bound fields (payment_id /
  // amount) didn't match the Payment doc. Required for the security
  // trail — the webhook log row marks `failed` but isn't surfaced
  // on the `/admin/audit` grid.
  eventBus.on("payment.tampering_attempted", async (payload) => {
    await auditService.log({
      action: "payment.tampering_attempted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payment",
      resourceId: payload.paymentId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        field: payload.field,
        expectedValue: payload.expectedValue,
        receivedValue: payload.receivedValue,
        providerName: payload.providerName,
      },
    });
  });

  // ── P1-21 — payment.bulk_expired ──
  // Emitted per committed batch by the `expire-stale-payments` admin
  // job. One audit row per batch (not per row) — the row carries the
  // `count` so the trail captures bulk mutations without ballooning.
  // `actorUid` (not `actorId`) on this payload mirrors the
  // `invite.bulk_expired` shape used by other bulk-job events.
  eventBus.on("payment.bulk_expired", async (payload) => {
    await auditService.log({
      action: "payment.bulk_expired",
      actorId: payload.actorUid,
      // Bulk-job events have no HTTP request id (the trigger is the
      // job runner, not a public route). The runId IS the equivalent
      // traceability handle, so we prefix it `job:` and pass it as
      // the requestId — keeps the audit row queryable by trace.
      requestId: `job:${payload.runId}`,
      timestamp: payload.processedAt,
      resourceType: "payment",
      resourceId: payload.runId,
      eventId: null,
      organizationId: null,
      details: {
        jobKey: payload.jobKey,
        runId: payload.runId,
        count: payload.count,
        cutoffIso: payload.cutoffIso,
      },
    });
  });

  // ── Member role change ────────────────────────────────────────────────
  // Distinct from user.role_changed (admin → global roles): this is the
  // org-scoped membership role update (owner/admin/member → organizer etc).

  eventBus.on("member.role_changed", async (payload) => {
    await auditService.log({
      action: "member.role_changed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "organization",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        memberId: payload.memberId,
        newRole: payload.newRole,
      },
    });
  });

  // ── Receipt ────────────────────────────────────────────────────────────

  eventBus.on("receipt.generated", async (payload) => {
    await auditService.log({
      action: "receipt.generated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "receipt",
      resourceId: payload.receiptId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        paymentId: payload.paymentId,
        userId: payload.userId,
        amount: payload.amount,
      },
    });
  });

  // ── Notification dispatcher (Phase 1) ──────────────────────────────────
  // Three events emitted by NotificationService: a send succeeded, a send
  // was suppressed (with reason), and a super-admin toggled a setting.
  // `resourceType: "notification"` groups them under a single filter in
  // the audit UI; resourceId is the catalog key so admins can drill into
  // "show me everything that happened for registration.created in the
  // last 24h" without a join.

  eventBus.on("notification.sent", async (payload) => {
    await auditService.log({
      action: "notification.sent",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.key,
      eventId: null,
      organizationId: null,
      details: {
        channel: payload.channel,
        recipientRef: payload.recipientRef,
        messageId: payload.messageId ?? null,
      },
    });
  });

  eventBus.on("notification.suppressed", async (payload) => {
    await auditService.log({
      action: "notification.suppressed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.key,
      eventId: null,
      organizationId: null,
      details: {
        reason: payload.reason,
        recipientRef: payload.recipientRef,
        channel: payload.channel ?? null,
      },
    });
  });

  eventBus.on("notification.deduplicated", async (payload) => {
    await auditService.log({
      action: "notification.deduplicated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.key,
      eventId: null,
      organizationId: null,
      details: {
        channel: payload.channel,
        recipientRef: payload.recipientRef,
        idempotencyKey: payload.idempotencyKey,
        originalAttemptedAt: payload.originalAttemptedAt,
      },
    });
  });

  eventBus.on("notification.setting_updated", async (payload) => {
    await auditService.log({
      action: "notification.setting_updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.key,
      eventId: null,
      // Phase 2.4 — surface per-org overrides in the org's audit log
      // alongside the platform-wide audit trail. Null = platform-wide.
      organizationId: payload.organizationId ?? null,
      details: {
        enabled: payload.enabled,
        channels: payload.channels,
        hasSubjectOverride: payload.hasSubjectOverride,
        scope: payload.organizationId ? "organization" : "platform",
        ...(payload.historyId ? { historyId: payload.historyId } : {}),
      },
    });
  });

  eventBus.on("notification.test_sent", async (payload) => {
    // Phase 2.4 — every admin "test send" lands in the audit trail.
    // Kept separate from `notification.sent` so the dispatch log stays
    // clean (test sends are out-of-band previews, not real delivery).
    await auditService.log({
      action: "notification.test_sent",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.key,
      eventId: null,
      organizationId: null,
      details: {
        channel: payload.channel,
        recipientRef: payload.recipientRef,
        locale: payload.locale,
        ...(payload.messageId ? { messageId: payload.messageId } : {}),
      },
    });
  });

  eventBus.on("notification.test_sent_self", async (payload) => {
    // Phase B.1 — user triggered a self-targeted test send from their
    // preferences page. Logged distinctly from admin-triggered test
    // sends so the admin audit view can tell the two apart at a glance.
    await auditService.log({
      action: "notification.test_sent_self",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.key,
      eventId: null,
      organizationId: null,
      details: {
        userId: payload.userId,
        locale: payload.locale,
      },
    });
  });

  eventBus.on("admin.delivery_dashboard_viewed", async (payload) => {
    // Phase D.3 — super-admin opened the delivery observability
    // dashboard. Audited because the query returns a cross-tenant view
    // of the dispatch log; we log the filters (key / channel / window)
    // so compliance reviewers can replay the exact slice.
    await auditService.log({
      action: "admin.delivery_dashboard_viewed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.key ?? "all",
      eventId: null,
      organizationId: null,
      details: {
        ...(payload.key ? { key: payload.key } : {}),
        ...(payload.channel ? { channel: payload.channel } : {}),
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
        granularity: payload.granularity,
        scanned: payload.scanned,
      },
    });
  });

  // ── FCM Device Tokens (Phase C.1 — Web Push) ──────────────────────────
  // Token registrations are user-scoped (no event / org), so both eventId
  // and organizationId are null. resourceId = userId so admins can filter
  // "all device-token activity for user X" at a glance. The raw token is
  // never persisted in the audit trail — only its sha256 fingerprint.

  eventBus.on("fcm.token_registered", async (payload) => {
    await auditService.log({
      action: "fcm.token_registered",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "user",
      resourceId: payload.userId,
      eventId: null,
      organizationId: null,
      details: {
        platform: payload.platform,
        tokenFingerprint: payload.tokenFingerprint,
        tokenCount: payload.tokenCount,
        status: payload.status,
      },
    });
  });

  eventBus.on("fcm.token_revoked", async (payload) => {
    await auditService.log({
      action: "fcm.token_revoked",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "user",
      resourceId: payload.userId,
      eventId: null,
      organizationId: null,
      details: {
        tokenFingerprint: payload.tokenFingerprint,
        removed: payload.removed,
        tokenCount: payload.tokenCount,
      },
    });
  });

  eventBus.on("fcm.tokens_cleared", async (payload) => {
    await auditService.log({
      action: "fcm.tokens_cleared",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "user",
      resourceId: payload.userId,
      eventId: null,
      organizationId: null,
      details: {
        removedCount: payload.removedCount,
      },
    });
  });

  // ── Web Push back-annotations (Phase C.2) ─────────────────────────────
  // The service worker POSTs to /v1/notifications/:id/push-displayed and
  // .../push-clicked after a background-delivered push is rendered /
  // clicked. The audit row carries only the notification id + user id —
  // no raw payload, no device / token info. Resource = notification so
  // a future dashboard can pivot from "sent" → "displayed" → "clicked"
  // on one id.

  eventBus.on("push.displayed", async (payload) => {
    await auditService.log({
      action: "push.displayed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.notificationId,
      eventId: null,
      organizationId: null,
      details: {
        userId: payload.userId,
      },
    });
  });

  eventBus.on("push.clicked", async (payload) => {
    await auditService.log({
      action: "push.clicked",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.notificationId,
      eventId: null,
      organizationId: null,
      details: {
        userId: payload.userId,
      },
    });
  });

  // ── API keys (T2.3) ────────────────────────────────────────────────────
  // Every create/revoke/rotate is a revenue-adjacent event (enterprise
  // tier only) — the audit trail is the mandatory compliance story.
  // Details never carry plaintext; only the non-secret metadata.
  // resourceType = "api_key", resourceId = hashPrefix (== doc id).

  eventBus.on("api_key.created", async (payload) => {
    await auditService.log({
      action: "api_key.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "api_key",
      resourceId: payload.apiKeyId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        name: payload.name,
        scopes: payload.scopes,
        environment: payload.environment,
      },
    });
  });

  eventBus.on("api_key.revoked", async (payload) => {
    await auditService.log({
      action: "api_key.revoked",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "api_key",
      resourceId: payload.apiKeyId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        reason: payload.reason,
      },
    });
  });

  eventBus.on("api_key.rotated", async (payload) => {
    await auditService.log({
      action: "api_key.rotated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "api_key",
      resourceId: payload.newApiKeyId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        previousApiKeyId: payload.previousApiKeyId,
        newApiKeyId: payload.newApiKeyId,
      },
    });
  });

  eventBus.on("api_key.verified", async (payload) => {
    // Throttled (one emit per key per hour per ipHash, enforced in
    // the service). We still audit every admitted call-pattern so
    // "key used from new IP" alerting can fire. `actorId` is the
    // synthesised `apikey:<hashPrefix>` uid — the key IS the actor.
    await auditService.log({
      action: "api_key.verified",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "api_key",
      resourceId: payload.apiKeyId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        ipHash: payload.ipHash,
        uaHash: payload.uaHash,
      },
    });
  });

  // ── Phase O6 — WhatsApp opt-in lifecycle (Meta-required consent log) ──

  eventBus.on("whatsapp.opt_in.granted", async (payload) => {
    // Privacy: do NOT persist `phoneE164` in the audit log (PII).
    // The phone number lives on the `whatsappOptIns/{id}` doc — an
    // investigator with `whatsapp:read` joins from `resourceId =
    // userId` + `organizationId` to retrieve it on demand. Same
    // treatment as the magic-link recipient email.
    await auditService.log({
      action: "whatsapp.opt_in.granted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "user",
      resourceId: payload.userId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        reGrant: payload.reGrant,
      },
    });
  });

  eventBus.on("whatsapp.opt_in.revoked", async (payload) => {
    // Privacy: do NOT persist `phoneE164` here either (PII). Lookup
    // via the `whatsappOptIns` doc when needed.
    await auditService.log({
      action: "whatsapp.opt_in.revoked",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "user",
      resourceId: payload.userId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {},
    });
  });

  eventBus.on("whatsapp.delivery.failed", async (payload) => {
    await auditService.log({
      action: "whatsapp.delivery.failed",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "notification",
      resourceId: payload.messageId,
      eventId: null,
      organizationId: null,
      details: {
        recipient: payload.recipient,
        errorCode: payload.errorCode,
        errorMessage: payload.errorMessage,
      },
    });
  });

  // ── Phase O7 — Participant ops (tags, notes, merge) ───────────────────

  eventBus.on("participant_profile.updated", async (payload) => {
    await auditService.log({
      action: "participant_profile.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "user",
      resourceId: payload.userId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        tags: payload.tags,
        notesChanged: payload.notesChanged,
      },
    });
  });

  eventBus.on("participant.merged", async (payload) => {
    await auditService.log({
      action: "participant.merged",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "user",
      resourceId: payload.primaryUserId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        secondaryUserId: payload.secondaryUserId,
        registrationsMoved: payload.registrationsMoved,
      },
    });
  });

  // ── Phase O8 — Live Event Mode (Floor Ops) ─────────────────────────────

  eventBus.on("incident.created", async (payload) => {
    await auditService.log({
      action: "incident.created",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.incidentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { kind: payload.kind, severity: payload.severity },
    });
  });

  eventBus.on("incident.updated", async (payload) => {
    await auditService.log({
      action: "incident.updated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.incidentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: payload.changes,
    });
  });

  eventBus.on("incident.resolved", async (payload) => {
    await auditService.log({
      action: "incident.resolved",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.incidentId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { durationMs: payload.durationMs },
    });
  });

  eventBus.on("emergency_broadcast.sent", async (payload) => {
    await auditService.log({
      action: "emergency_broadcast.sent",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        reason: payload.reason,
        channels: payload.channels,
        recipientCount: payload.recipientCount,
        dispatchedCount: payload.dispatchedCount,
      },
    });
  });

  eventBus.on("staff_message.posted", async (payload) => {
    // Privacy: we audit the FACT a message was posted (forensic trail)
    // without persisting the body. The messageId is enough to retrieve
    // the row during a moderation review.
    await auditService.log({
      action: "staff_message.posted",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { messageId: payload.messageId },
    });
  });

  // ── Post-event report + cohort + payout request (Phase O9) ────────────

  eventBus.on("post_event_report.generated", async (payload) => {
    await auditService.log({
      action: "post_event_report.generated",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        registered: payload.registered,
        checkedIn: payload.checkedIn,
        grossAmount: payload.grossAmount,
        payoutAmount: payload.payoutAmount,
      },
    });
  });

  eventBus.on("cohort_export.downloaded", async (payload) => {
    // PII risk — the row count + segment is enough to investigate a
    // leak. The participant rows themselves never enter the audit log.
    await auditService.log({
      action: "cohort_export.downloaded",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { segment: payload.segment, rowCount: payload.rowCount },
    });
  });

  eventBus.on("payout.requested", async (payload) => {
    await auditService.log({
      action: "payout.requested",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "payout",
      resourceId: payload.payoutId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { netAmount: payload.netAmount },
    });
  });

  // ── Event templates + magic links (Phase O10) ─────────────────────────

  eventBus.on("event.cloned_from_template", async (payload) => {
    await auditService.log({
      action: "event.cloned_from_template",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "event",
      resourceId: payload.eventId,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        templateId: payload.templateId,
        sessionsAdded: payload.sessionsAdded,
        commsBlueprintsAdded: payload.commsBlueprintsAdded,
      },
    });
  });

  eventBus.on("magic_link.issued", async (payload) => {
    // Privacy: we record the tokenHash (NEVER the plaintext token) +
    // role + expiry. The recipient email is intentionally omitted —
    // it lives on the magicLinks/{tokenHash} Firestore doc for
    // forensic lookups, but doesn't enter the immutable audit log.
    await auditService.log({
      action: "magic_link.issued",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "magic_link",
      resourceId: payload.tokenHash,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: {
        role: payload.role,
        expiresAt: payload.expiresAt,
      },
    });
  });

  eventBus.on("magic_link.used", async (payload) => {
    await auditService.log({
      action: "magic_link.used",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "magic_link",
      resourceId: payload.tokenHash,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { role: payload.role },
    });
  });

  eventBus.on("magic_link.revoked", async (payload) => {
    await auditService.log({
      action: "magic_link.revoked",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "magic_link",
      resourceId: payload.tokenHash,
      eventId: payload.eventId,
      organizationId: payload.organizationId,
      details: { role: payload.role },
    });
  });

  // ── Subscription Override (Phase 5 — admin per-org assign) ─────────────

  eventBus.on("subscription.overridden", async (payload) => {
    await auditService.log({
      action: "subscription.overridden",
      actorId: payload.actorId,
      requestId: payload.requestId,
      timestamp: payload.timestamp,
      resourceType: "subscription",
      resourceId: payload.organizationId,
      eventId: null,
      organizationId: payload.organizationId,
      details: {
        previousPlan: payload.previousPlan,
        newPlanKey: payload.newPlanKey,
        newPlanId: payload.newPlanId,
        hasOverrides: payload.hasOverrides,
        validUntil: payload.validUntil,
      },
    });
  });
}
