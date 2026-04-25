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

  it("logs newsletter.subscriber_created with subscriber id + email", async () => {
    eventBus.emit("newsletter.subscriber_created", {
      subscriberId: "sub-42",
      email: "sub@test.com",
      source: "website",
      actorId: "anonymous",
      requestId: "req-nl",
      timestamp: "2026-04-21T10:00:00.000Z",
    });
    await flush();

    expect(auditService.log).toHaveBeenCalledWith({
      action: "newsletter.subscriber_created",
      actorId: "anonymous",
      requestId: "req-nl",
      timestamp: "2026-04-21T10:00:00.000Z",
      resourceType: "newsletter_subscriber",
      resourceId: "sub-42",
      eventId: null,
      organizationId: null,
      details: { email: "sub@test.com", source: "website" },
    });
  });

  it("logs newsletter.subscriber_confirmed with email + confirmedAt (consent trail)", async () => {
    // GDPR/CASL: the audit log entry for this event is the legally
    // defensible "when did the user consent" record.
    eventBus.emit("newsletter.subscriber_confirmed", {
      subscriberId: "sub-99",
      email: "confirmed@test.com",
      confirmedAt: "2026-04-21T12:30:00.000Z",
      actorId: "anonymous",
      requestId: "req-nl-3",
      timestamp: "2026-04-21T12:30:00.000Z",
    });
    await flush();

    expect(auditService.log).toHaveBeenCalledWith({
      action: "newsletter.subscriber_confirmed",
      actorId: "anonymous",
      requestId: "req-nl-3",
      timestamp: "2026-04-21T12:30:00.000Z",
      resourceType: "newsletter_subscriber",
      resourceId: "sub-99",
      eventId: null,
      organizationId: null,
      details: {
        email: "confirmed@test.com",
        confirmedAt: "2026-04-21T12:30:00.000Z",
      },
    });
  });

  it("logs newsletter.sent with actor + broadcast id + subject", async () => {
    eventBus.emit("newsletter.sent", {
      broadcastId: "bc-7",
      subject: "April digest",
      segmentId: "seg_abc",
      actorId: "admin-1",
      requestId: "req-nl-2",
      timestamp: "2026-04-21T11:00:00.000Z",
    });
    await flush();

    expect(auditService.log).toHaveBeenCalledWith({
      action: "newsletter.sent",
      actorId: "admin-1",
      requestId: "req-nl-2",
      timestamp: "2026-04-21T11:00:00.000Z",
      resourceType: "newsletter_broadcast",
      resourceId: "bc-7",
      eventId: null,
      organizationId: null,
      details: { subject: "April digest", segmentId: "seg_abc" },
    });
  });

  it("logs notification.unsubscribed when a subscriber clicks List-Unsubscribe", async () => {
    eventBus.emit("notification.unsubscribed", {
      userId: "user-42",
      category: "transactional",
      source: "list_unsubscribe_click",
      actorId: "user-42", // self-service
      requestId: "req-unsub-1",
      timestamp: "2026-04-21T13:00:00.000Z",
    });
    await flush();

    expect(auditService.log).toHaveBeenCalledWith({
      action: "notification.unsubscribed",
      actorId: "user-42",
      requestId: "req-unsub-1",
      timestamp: "2026-04-21T13:00:00.000Z",
      resourceType: "notification_preference",
      resourceId: "user-42",
      eventId: null,
      organizationId: null,
      details: { category: "transactional", source: "list_unsubscribe_click" },
    });
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

  // ─── Notification dispatcher (Phase 1) ─────────────────────────────────
  // Three events from NotificationDispatcherService: a successful send
  // (channel delivered), a suppression (with reason), and a super-admin
  // kill-switch / channel override write. All three land under
  // resourceType="notification" so the audit UI can filter by catalog key.

  it("logs notification.sent with channel + recipient ref + messageId", async () => {
    eventBus.emit("notification.sent", {
      actorId: "system",
      requestId: "req-notif-1",
      timestamp: "2026-04-21T10:00:00.000Z",
      key: "registration.created",
      channel: "email",
      recipientRef: "user:u-123",
      messageId: "resend-msg-abc",
    });
    await flush();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification.sent",
        resourceType: "notification",
        resourceId: "registration.created",
        actorId: "system",
        details: expect.objectContaining({
          channel: "email",
          recipientRef: "user:u-123",
          messageId: "resend-msg-abc",
        }),
      }),
    );
  });

  it("logs notification.deduplicated with idempotencyKey + originalAttemptedAt", async () => {
    eventBus.emit("notification.deduplicated", {
      actorId: "system",
      requestId: "req-notif-dedup-1",
      timestamp: "2026-04-22T12:00:00.000Z",
      key: "registration.created",
      channel: "email",
      recipientRef: "user:u-dup",
      idempotencyKey: "registration.created:u-dup:reg-confirm/r-99",
      originalAttemptedAt: "2026-04-22T11:00:00.000Z",
    });
    await flush();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification.deduplicated",
        resourceType: "notification",
        resourceId: "registration.created",
        actorId: "system",
        details: expect.objectContaining({
          channel: "email",
          recipientRef: "user:u-dup",
          idempotencyKey: "registration.created:u-dup:reg-confirm/r-99",
          originalAttemptedAt: "2026-04-22T11:00:00.000Z",
        }),
      }),
    );
  });

  it("logs notification.suppressed with reason (admin_disabled)", async () => {
    eventBus.emit("notification.suppressed", {
      actorId: "system",
      requestId: "req-notif-2",
      timestamp: "2026-04-21T10:00:00.000Z",
      key: "registration.created",
      recipientRef: "user:u-123",
      reason: "admin_disabled",
    });
    await flush();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification.suppressed",
        resourceType: "notification",
        resourceId: "registration.created",
        details: expect.objectContaining({
          reason: "admin_disabled",
          recipientRef: "user:u-123",
          channel: null,
        }),
      }),
    );
  });

  it("logs notification.setting_updated with enabled/channels diff", async () => {
    eventBus.emit("notification.setting_updated", {
      actorId: "admin-u-1",
      requestId: "req-notif-3",
      timestamp: "2026-04-21T10:00:00.000Z",
      key: "event.reminder",
      organizationId: null,
      enabled: false,
      channels: ["email"],
      hasSubjectOverride: true,
    });
    await flush();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification.setting_updated",
        resourceType: "notification",
        resourceId: "event.reminder",
        actorId: "admin-u-1",
        details: expect.objectContaining({
          enabled: false,
          channels: ["email"],
          hasSubjectOverride: true,
        }),
      }),
    );
  });

  // ─── SPEC: dynamic completeness check (post-audit) ─────────────────────
  // Pre-audit, the suite hard-coded `toHaveBeenCalledTimes(18)` which
  // silently rotted when new domain events were added to
  // `audit.listener.ts`. 67 handlers are registered today but only 18
  // were being checked — a new event type could land with no audit
  // mapping and no test would fail.
  //
  // This test fails loud when:
  //   - a new `eventBus.on(...)` handler is added but the reference
  //     count below isn't updated (forces a code-review sync point),
  //   - OR someone removes a handler without updating the count
  //     (deletions are real; the count must shift deliberately).
  //
  // The reference number is NOT a goal — it's a "sync checkpoint".
  // When you add or remove an audit handler, bump the number AND
  // make sure `audit.listener.test.ts` has coverage for the new
  // event's mapping.
  describe("audit listener — dynamic handler completeness", () => {
    it("registers the expected number of eventBus listeners (reference count)", () => {
      // Fresh bus so only this registration is counted — the outer
      // beforeEach already ran `removeAllListeners` + registers once.
      // We recount against the live registry.
      eventBus.removeAllListeners();
      const registered: string[] = [];
      const originalOn = eventBus.on.bind(eventBus);
      const spy = vi
        .spyOn(eventBus, "on")
        // Cast through unknown — the typed EventBus signature rejects
        // an untyped (name, handler) forward, but we're intentionally
        // intercepting the generic case for completeness counting.
        .mockImplementation(((name: unknown, handler: unknown) => {
          registered.push(name as string);
          return (originalOn as unknown as (n: unknown, h: unknown) => void)(name, handler);
        }) as unknown as typeof eventBus.on);

      registerAuditListeners();
      spy.mockRestore();

      // When this count changes deliberately (you added a domain event
      // + its audit handler), bump this number AND add a targeted
      // emission test somewhere in this file that verifies the new
      // mapping writes the right `action` / `resourceType` to the
      // audit log. If you removed a handler, also drop the matching
      // emission test so stale expectations don't silently pass.
      // Phase 2.4 added `notification.test_sent` (+1 handler over the
      // 76 registered as of Phase 2.3). Phase B.1 added
      // `notification.test_sent_self` (+1) for the user-triggered
      // self-test flow. Phase C.1 added the three `fcm.*` handlers
      // (token_registered, token_revoked, tokens_cleared) for the
      // Web Push credential lifecycle (+3). Phase C.2 added the two
      // `push.displayed` / `push.clicked` back-annotation handlers
      // written by the service worker (+2). Phase D.3 added the
      // `admin.delivery_dashboard_viewed` handler emitted by the super-
      // admin observability dashboard route (+1). T2.3 added the
      // `api_key.created` / `api_key.revoked` / `api_key.rotated`
      // handlers for the org-scoped API-key issuance console (+3).
      // T2.3 senior-review remediation added `api_key.verified` (+1)
      // for throttled per-request leak-detection audit rows.
      // Phase 7+ item #7 added three plan-coupon lifecycle handlers
      // (`plan_coupon.created` / `.updated` / `.archived`) — redemption
      // itself is captured on subscription.upgraded + the
      // couponRedemptions collection, not as a dedicated audit action.
      // Phase 7+ item #B1 added two recurring-series handlers
      // (`event.series_created` / `.series_published`) so audit queries
      // can tell bulk-series ops apart from single-event creates.
      // B2 follow-up added the `waitlist.bulk_promoted` aggregate
      // handler — the per-entry `waitlist.promoted` events drive
      // notification dispatch, this aggregate gives ops a single
      // audit row per bulk-promote run.
      // Sprint-2 T2.2 — `event.restored` listener added.
      // Sprint-2 S1 — `event.series_cancelled` listener added.
      // Sprint-4 T3.2 — 3 scheduled_admin_op.* listeners added.
      const EXPECTED_HANDLER_COUNT = 99;

      expect(registered).toHaveLength(EXPECTED_HANDLER_COUNT);
      // Each registered event name should be unique — a double
      // registration would cause the audit to fire twice for one
      // domain event.
      expect(new Set(registered).size).toBe(registered.length);
    });

    it("every registered handler calls auditService.log when its event fires (structural check)", async () => {
      // Re-register cleanly for this test so the listener count is
      // independent of other tests in this file that already ran.
      eventBus.removeAllListeners();

      // Capture the registered event names the same way as above.
      const registered: string[] = [];
      const originalOn = eventBus.on.bind(eventBus);
      const spy = vi
        .spyOn(eventBus, "on")
        // Cast through unknown — the typed EventBus signature rejects
        // an untyped (name, handler) forward, but we're intentionally
        // intercepting the generic case for completeness counting.
        .mockImplementation(((name: unknown, handler: unknown) => {
          registered.push(name as string);
          return (originalOn as unknown as (n: unknown, h: unknown) => void)(name, handler);
        }) as unknown as typeof eventBus.on);
      registerAuditListeners();
      spy.mockRestore();

      // For each captured event name, emit a minimal payload that
      // satisfies the shared fields every audit handler reads
      // (`actorId`, `requestId`, `timestamp`). Per-event extra fields
      // default to empty / null / "stub" — we're testing the mapping
      // is wired, not the detailed shape.
      for (const name of registered) {
        // Cast to the typed emit signature — we're iterating over the
        // full DomainEventName union at runtime with a permissive stub
        // payload; the type-narrow per-event is out of scope here.
        (eventBus.emit as unknown as (n: string, p: unknown) => void)(name, {
          actorId: "structural-test",
          requestId: `req-${name}`,
          timestamp: new Date().toISOString(),
          // Cast-through fallback fields commonly needed:
          eventId: "e-stub",
          organizationId: "o-stub",
          registrationId: "r-stub",
          userId: "u-stub",
          memberId: "m-stub",
          planId: "p-stub",
          subscriptionId: "s-stub",
          changes: {},
          reason: "stub",
          // Registration + Event + Org shaped stubs for handlers that
          // cast the payload into a full domain object:
          registration: {
            id: "r-stub",
            eventId: "e-stub",
            userId: "u-stub",
            status: "confirmed",
          },
          event: {
            id: "e-stub",
            organizationId: "o-stub",
            title: "stub",
            status: "published",
          },
          organization: { id: "o-stub", name: "Stub Org" },
          // checkin-specific:
          registrationId_: "r-stub",
          checkedInBy: "staff-stub",
          source: "live",
          // event lifecycle:
          eventStatus: "published",
          ticketTypeId: "tt-stub",
          ticketTypeName: "Stub",
          sourceEventId: "e-stub-src",
          // member ops:
          role: "member",
          // payment / subscription:
          amount: 0,
          newKid: "kid-new",
          previousKid: "kid-old",
          itemCount: 0,
          // notification dispatcher:
          key: "registration.created",
          channel: "email",
          recipientRef: "user:u-stub",
          enabled: true,
          channels: ["email"],
          hasSubjectOverride: false,
        });
      }

      await flush();

      // Every listener must fire auditService.log at least once on its
      // own emit. The exact arg shapes are verified by the targeted
      // tests above — this is the "no silent drops" floor.
      // If any handler threw or bailed without calling log, the count
      // would be less than the listener count.
      expect(
        (auditService.log as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
      ).toBeGreaterThanOrEqual(registered.length);
    });
  });
});
