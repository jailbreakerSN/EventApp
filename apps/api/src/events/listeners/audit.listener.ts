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
        cancelledRegistrationId: payload.cancelledRegistrationId,
        reason: payload.reason,
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

  // ── Member role change ────────────────────────────────────────────────
  // Distinct from user.role_changed (admin → global roles): this is the
  // org-scoped membership role update (owner/admin/member → organizer etc).

  eventBus.on("member.role_updated", async (payload) => {
    await auditService.log({
      action: "member.role_updated",
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
