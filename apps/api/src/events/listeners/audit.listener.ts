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
}
