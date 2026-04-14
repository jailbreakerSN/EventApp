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
      organizationId: null,
      details: {
        participantId: payload.participantId,
        staffId: payload.staffId,
        accessZoneId: payload.accessZoneId ?? null,
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
      organizationId: null,
      details: {
        registrationId: payload.registrationId,
        userId: payload.userId,
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
}
