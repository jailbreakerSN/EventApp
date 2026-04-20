import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventBus } from "../event-bus";
import { auditService } from "@/services/audit.service";
import { registerAuditListeners } from "../listeners/audit.listener";
import {
  type RegistrationCreatedEvent,
  type CheckInCompletedEvent,
  type EventPublishedEvent,
  type TicketTypeAddedEvent,
} from "../domain-events";
import type { Registration, Event, Organization } from "@teranga/shared-types";

vi.mock("@/services/audit.service", () => ({
  auditService: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

beforeEach(() => {
  eventBus.removeAllListeners();
  vi.clearAllMocks();
  registerAuditListeners();
});

/** Flush setImmediate-scheduled callbacks and microtask queue */
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

describe("Audit Listener", () => {
  it("logs registration.created with correct fields", async () => {
    const payload: RegistrationCreatedEvent = {
      registration: {
        id: "reg-1",
        eventId: "ev-1",
        userId: "u-1",
        ticketTypeId: "tt-1",
        status: "confirmed",
      } as unknown as Registration,
      eventId: "ev-1",
      organizationId: "org-1",
      actorId: "u-1",
      requestId: "req-abc",
      timestamp: "2026-04-04T10:00:00.000Z",
    };

    eventBus.emit("registration.created", payload);
    await flush();

    expect(auditService.log).toHaveBeenCalledWith({
      action: "registration.created",
      actorId: "u-1",
      requestId: "req-abc",
      timestamp: "2026-04-04T10:00:00.000Z",
      resourceType: "registration",
      resourceId: "reg-1",
      eventId: "ev-1",
      organizationId: "org-1",
      details: {
        userId: "u-1",
        ticketTypeId: "tt-1",
        status: "confirmed",
      },
    });
  });

  it("logs checkin.completed with staff and zone info", async () => {
    const payload: CheckInCompletedEvent = {
      registrationId: "reg-2",
      eventId: "ev-1",
      organizationId: "org-1",
      participantId: "u-2",
      staffId: "staff-1",
      accessZoneId: "zone-vip",
      actorId: "staff-1",
      requestId: "req-def",
      timestamp: "2026-04-04T11:00:00.000Z",
    };

    eventBus.emit("checkin.completed", payload);
    await flush();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "checkin.completed",
        resourceType: "registration",
        resourceId: "reg-2",
        details: expect.objectContaining({
          staffId: "staff-1",
          accessZoneId: "zone-vip",
        }),
      }),
    );
  });

  it("logs event.published with event title", async () => {
    const payload: EventPublishedEvent = {
      event: { id: "ev-1", title: "Teranga Fest" } as unknown as Event,
      organizationId: "org-1",
      actorId: "u-org",
      requestId: "req-ghi",
      timestamp: "2026-04-04T12:00:00.000Z",
    };

    eventBus.emit("event.published", payload);
    await flush();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event.published",
        resourceType: "event",
        resourceId: "ev-1",
        details: { title: "Teranga Fest" },
      }),
    );
  });

  it("logs ticket_type.added with correct fields", async () => {
    const payload: TicketTypeAddedEvent = {
      eventId: "ev-1",
      organizationId: "org-1",
      ticketTypeId: "tt-new",
      ticketTypeName: "VIP",
      actorId: "u-org",
      requestId: "req-tt",
      timestamp: "2026-04-05T10:00:00.000Z",
    };

    eventBus.emit("ticket_type.added", payload);
    await flush();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ticket_type.added",
        resourceType: "event",
        resourceId: "ev-1",
        details: {
          ticketTypeId: "tt-new",
          ticketTypeName: "VIP",
        },
      }),
    );
  });

  it("logs all 16 event types", async () => {
    eventBus.emit("registration.created", {
      registration: {
        id: "r1",
        userId: "u1",
        ticketTypeId: "t1",
        status: "confirmed",
      } as unknown as Registration,
      eventId: "e1",
      organizationId: "o1",
      actorId: "a1",
      requestId: "req1",
      timestamp: "t1",
    });
    eventBus.emit("registration.cancelled", {
      registrationId: "r2",
      eventId: "e1",
      userId: "u1",
      organizationId: "o1",
      actorId: "a1",
      requestId: "req2",
      timestamp: "t2",
    });
    eventBus.emit("registration.approved", {
      registrationId: "r3",
      eventId: "e1",
      userId: "u1",
      organizationId: "o1",
      actorId: "a1",
      requestId: "req3",
      timestamp: "t3",
    });
    eventBus.emit("checkin.completed", {
      registrationId: "r4",
      eventId: "e1",
      organizationId: "o1",
      participantId: "u1",
      staffId: "s1",
      actorId: "s1",
      requestId: "req4",
      timestamp: "t4",
    });
    eventBus.emit("event.created", {
      event: { id: "e1", title: "New Event" } as unknown as Event,
      organizationId: "o1",
      actorId: "a1",
      requestId: "req5a",
      timestamp: "t5a",
    });
    eventBus.emit("event.updated", {
      eventId: "e1",
      organizationId: "o1",
      changes: { title: "Updated" },
      actorId: "a1",
      requestId: "req5b",
      timestamp: "t5b",
    });
    eventBus.emit("event.published", {
      event: { id: "e1", title: "Test" } as unknown as Event,
      organizationId: "o1",
      actorId: "a1",
      requestId: "req5",
      timestamp: "t5",
    });
    eventBus.emit("event.cancelled", {
      eventId: "e1",
      organizationId: "o1",
      actorId: "a1",
      requestId: "req6",
      timestamp: "t6",
    });
    eventBus.emit("event.archived", {
      eventId: "e1",
      organizationId: "o1",
      actorId: "a1",
      requestId: "req7",
      timestamp: "t7",
    });
    eventBus.emit("organization.created", {
      organization: { id: "o1", name: "Test Org", plan: "free" } as unknown as Organization,
      actorId: "a1",
      requestId: "req8",
      timestamp: "t8",
    });
    eventBus.emit("member.added", {
      organizationId: "o1",
      memberId: "m1",
      actorId: "a1",
      requestId: "req9",
      timestamp: "t9",
    });
    eventBus.emit("member.removed", {
      organizationId: "o1",
      memberId: "m1",
      actorId: "a1",
      requestId: "req10",
      timestamp: "t10",
    });
    eventBus.emit("badge.generated", {
      badgeId: "b1",
      registrationId: "r1",
      eventId: "e1",
      organizationId: "o1",
      userId: "u1",
      actorId: "a1",
      requestId: "req11",
      timestamp: "t11",
    });
    eventBus.emit("waitlist.promoted", {
      registrationId: "r5",
      eventId: "e1",
      userId: "u1",
      organizationId: "o1",
      actorId: "a1",
      requestId: "req12",
      timestamp: "t12",
    });
    eventBus.emit("event.unpublished", {
      eventId: "e1",
      organizationId: "o1",
      actorId: "a1",
      requestId: "req13",
      timestamp: "t13",
    });
    eventBus.emit("ticket_type.added", {
      eventId: "e1",
      organizationId: "o1",
      ticketTypeId: "tt-1",
      ticketTypeName: "VIP",
      actorId: "a1",
      requestId: "req14",
      timestamp: "t14",
    });
    eventBus.emit("ticket_type.updated", {
      eventId: "e1",
      organizationId: "o1",
      ticketTypeId: "tt-1",
      changes: { name: "VVIP" },
      actorId: "a1",
      requestId: "req15",
      timestamp: "t15",
    });
    eventBus.emit("ticket_type.removed", {
      eventId: "e1",
      organizationId: "o1",
      ticketTypeId: "tt-1",
      ticketTypeName: "VIP",
      actorId: "a1",
      requestId: "req16",
      timestamp: "t16",
    });

    await flush();

    expect(auditService.log).toHaveBeenCalledTimes(18);
  });

  it("logs waitlist.promotion_failed with cancelledRegistrationId + reason", async () => {
    // Regression guard for the Sprint 1 silent-error fix: when the
    // cancel-triggered waitlist promotion fails after the cancel has
    // already committed, the service emits this event so the audit
    // trail records the stuck-slot state (event has a registered count
    // 1 lower than expected, waitlisted user wasn't promoted). Without
    // this listener the operator gets no visibility at all.
    eventBus.emit("waitlist.promotion_failed", {
      eventId: "ev-99",
      organizationId: "org-1",
      cancelledRegistrationId: "reg-cancelled-42",
      reason: "Firestore unavailable: transaction retry exceeded",
      actorId: "user-who-cancelled",
      requestId: "req-failed",
      timestamp: "2026-04-16T13:00:00.000Z",
    });

    await flush();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "waitlist.promotion_failed",
        resourceType: "event",
        resourceId: "ev-99",
        eventId: "ev-99",
        organizationId: "org-1",
        actorId: "user-who-cancelled",
        details: expect.objectContaining({
          cancelledRegistrationId: "reg-cancelled-42",
          reason: expect.stringContaining("Firestore unavailable"),
        }),
      }),
    );
  });
});
