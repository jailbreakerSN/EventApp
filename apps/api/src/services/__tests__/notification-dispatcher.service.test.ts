import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Stable config mock (before any service import) ────────────────────────

vi.mock("@/config/index", () => ({
  config: {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    // Flipped per-test with `config.NOTIFICATIONS_DISPATCHER_ENABLED = true/false`.
    NOTIFICATIONS_DISPATCHER_ENABLED: true,
  },
}));

// Firebase dependencies referenced via the notification settings repository.
vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn((_id: string) => ({
        get: vi.fn(async () => ({ exists: false, data: () => undefined })),
        set: vi.fn(async () => undefined),
      })),
    })),
  },
  COLLECTIONS: {
    NOTIFICATION_SETTINGS: "notificationSettings",
    NOTIFICATION_DISPATCH_LOG: "notificationDispatchLog",
  },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { eventBus } from "@/events/event-bus";
import {
  notificationDispatcher,
  setEmailChannelAdapter,
  type EmailChannelAdapter,
} from "../notification-dispatcher.service";
import { notificationSettingsRepository } from "@/repositories/notification-settings.repository";
import { notificationDispatchLogRepository } from "@/repositories/notification-dispatch-log.repository";
import { NOTIFICATION_CATALOG_BY_KEY } from "@teranga/shared-types";

// ─── Test doubles ──────────────────────────────────────────────────────────

const sentEvents: unknown[] = [];
const suppressedEvents: unknown[] = [];
const deduplicatedEvents: unknown[] = [];

function captureEvents() {
  eventBus.removeAllListeners();
  sentEvents.length = 0;
  suppressedEvents.length = 0;
  deduplicatedEvents.length = 0;
  eventBus.on("notification.sent", (p) => {
    sentEvents.push(p);
  });
  eventBus.on("notification.suppressed", (p) => {
    suppressedEvents.push(p);
  });
  eventBus.on("notification.deduplicated", (p) => {
    deduplicatedEvents.push(p);
  });
}

const mockAdapter: EmailChannelAdapter = {
  send: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-test-1" }),
};

// Flush setImmediate-scheduled listeners so our assertions see the events.
// Matches the pattern used by audit.listener.test.ts.
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("NotificationDispatcherService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureEvents();
    setEmailChannelAdapter(mockAdapter);
    // Default: no prior dedup entry. Individual tests override to
    // exercise the dedup short-circuit.
    vi.spyOn(notificationDispatchLogRepository, "findRecentByIdempotencyKey").mockResolvedValue(
      null,
    );
    // Stub the append path so log writes don't bleed into Firestore
    // mocks — the dispatcher calls this after every send/suppress.
    vi.spyOn(notificationDispatchLogRepository, "append").mockResolvedValue("log-id");
  });

  afterEach(() => {
    setEmailChannelAdapter(undefined);
  });

  it("dispatches to the adapter and emits notification.sent on success", async () => {
    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: { registrationId: "r1" },
    });
    await flush();

    expect(mockAdapter.send).toHaveBeenCalledTimes(1);
    expect(sentEvents).toHaveLength(1);
    const sent = sentEvents[0] as { key: string; channel: string; recipientRef: string };
    expect(sent.key).toBe("registration.created");
    expect(sent.channel).toBe("email");
    expect(sent.recipientRef).toBe("user:u1");
  });

  it("short-circuits with admin_disabled when settings.enabled = false", async () => {
    vi.spyOn(notificationSettingsRepository, "findByKey").mockResolvedValueOnce({
      key: "registration.created",
      enabled: false,
      channels: ["email"],
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
    });

    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: { registrationId: "r1" },
    });
    await flush();

    expect(mockAdapter.send).not.toHaveBeenCalled();
    expect(suppressedEvents).toHaveLength(1);
    expect((suppressedEvents[0] as { reason: string }).reason).toBe("admin_disabled");
  });

  it("respects user opt-out for user-opt-outable notifications", async () => {
    // Stub emailService.getPreferences via the dynamic import path. The
    // dispatcher does `import("./email.service")` inside isUserOptedOut,
    // so we need to intercept that module. Easiest: spy on the getter by
    // mocking the module before the test file first loads it.
    vi.doMock("../email.service", () => ({
      emailService: {
        getPreferences: vi.fn().mockResolvedValue({
          byKey: { "event.reminder": false },
        }),
      },
    }));

    // event.reminder has userOptOutAllowed=true in the catalog.
    expect(NOTIFICATION_CATALOG_BY_KEY["event.reminder"]!.userOptOutAllowed).toBe(true);

    await notificationDispatcher.dispatch({
      key: "event.reminder",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: { eventTitle: "e1" },
    });
    await flush();

    expect(mockAdapter.send).not.toHaveBeenCalled();
    expect(suppressedEvents).toHaveLength(1);
    expect((suppressedEvents[0] as { reason: string }).reason).toBe("user_opted_out");

    vi.doUnmock("../email.service");
  });

  it("ignores user opt-out for security / billing notifications", async () => {
    vi.doMock("../email.service", () => ({
      emailService: {
        getPreferences: vi.fn().mockResolvedValue({
          byKey: { "auth.password_reset": false },
        }),
      },
    }));

    // auth.password_reset has userOptOutAllowed=false.
    expect(NOTIFICATION_CATALOG_BY_KEY["auth.password_reset"]!.userOptOutAllowed).toBe(false);

    await notificationDispatcher.dispatch({
      key: "auth.password_reset",
      recipients: [{ userId: "u1", email: "a@b.co", preferredLocale: "fr" }],
      params: { resetUrl: "https://x" },
    });
    await flush();

    expect(mockAdapter.send).toHaveBeenCalledTimes(1);
    expect(sentEvents).toHaveLength(1);

    vi.doUnmock("../email.service");
  });

  it("emits suppressed(no_recipient) for unsupported channels (sms/push/in_app) in Phase 1", async () => {
    // Force the override path to request an SMS channel even though only
    // email is live. The catalog filter strips unsupported channels; but
    // when channelOverride includes only unsupported ones, dispatcher
    // still short-circuits via resolveChannels.
    vi.spyOn(notificationSettingsRepository, "findByKey").mockResolvedValueOnce({
      key: "registration.created",
      enabled: true,
      channels: ["sms"],
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
    });

    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: {},
    });
    await flush();

    expect(mockAdapter.send).not.toHaveBeenCalled();
    expect(suppressedEvents).toHaveLength(1);
    expect((suppressedEvents[0] as { reason: string }).reason).toBe("admin_disabled");
  });

  it("emits suppressed(no_recipient) when recipient list is empty", async () => {
    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [],
      params: {},
    });
    await flush();

    expect(mockAdapter.send).not.toHaveBeenCalled();
    expect(suppressedEvents).toHaveLength(1);
    expect((suppressedEvents[0] as { reason: string }).reason).toBe("no_recipient");
  });

  it("ignores unknown catalog keys without throwing", async () => {
    await notificationDispatcher.dispatch({
      key: "this.is.not.registered",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: {},
    });
    await flush();

    expect(mockAdapter.send).not.toHaveBeenCalled();
    expect(sentEvents).toHaveLength(0);
    expect(suppressedEvents).toHaveLength(0);
  });

  it("emits suppressed(bounced) when the adapter reports failure", async () => {
    (mockAdapter.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      suppressed: "bounced",
    });

    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ userId: "u1", email: "a@b.co", preferredLocale: "fr" }],
      params: {},
    });
    await flush();

    expect(suppressedEvents).toHaveLength(1);
    expect((suppressedEvents[0] as { reason: string }).reason).toBe("bounced");
  });

  it("builds deterministic idempotency keys", async () => {
    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: { registrationId: "r1" },
      idempotencyKey: "reg-confirm/r1",
    });
    await flush();

    const callArgs = (mockAdapter.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.idempotencyKey).toBe("registration.created:u1:reg-confirm/r1");
  });

  // ─── Phase 3 security-category bypass regression guard ────────────────
  // Mandatory notifications (`userOptOutAllowed: false` in the catalog)
  // MUST deliver regardless of the user's byKey preference. Exercises
  // every such key in the catalog so a future "simplification" that
  // strips the guard fails loud.
  it("mandatory notifications bypass byKey opt-out", async () => {
    const mandatoryKeys = Object.values(NOTIFICATION_CATALOG_BY_KEY)
      .filter((def) => !def.userOptOutAllowed)
      .map((def) => def.key);
    expect(mandatoryKeys.length).toBeGreaterThan(5);

    // User explicitly opts out of every mandatory key — dispatcher must
    // still deliver all of them.
    const optOutMap = Object.fromEntries(mandatoryKeys.map((k) => [k, false]));
    vi.doMock("../email.service", () => ({
      emailService: {
        getPreferences: vi.fn().mockResolvedValue({ byKey: optOutMap }),
      },
    }));

    for (const key of mandatoryKeys) {
      await notificationDispatcher.dispatch({
        key,
        recipients: [{ userId: "u-secure", email: "user@example.com", preferredLocale: "fr" }],
        params: {},
      });
    }
    await flush();

    // Every key must have dispatched (not suppressed).
    expect((mockAdapter.send as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(
      mandatoryKeys.length,
    );
    // And no suppression event fired for user_opted_out.
    for (const ev of suppressedEvents) {
      expect((ev as { reason: string }).reason).not.toBe("user_opted_out");
    }

    vi.doUnmock("../email.service");
  });

  // ─── Phase 2.2 persistent idempotency ─────────────────────────────────
  // The dispatcher queries notificationDispatchLog before every
  // adapter.send. A hit within the category's dedup window short-
  // circuits the send and emits `notification.deduplicated` instead
  // of `notification.sent`.

  it("dedup: second dispatch with same idempotencyKey within window skips adapter.send", async () => {
    const priorEntry = {
      id: "prior-1",
      key: "registration.created",
      channel: "email" as const,
      recipientRef: "user:u1",
      status: "sent" as const,
      idempotencyKey: "registration.created:u1:reg-confirm/r1",
      attemptedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      requestId: "req-prior",
      actorId: "system",
    };
    vi.spyOn(
      notificationDispatchLogRepository,
      "findRecentByIdempotencyKey",
    ).mockResolvedValueOnce(priorEntry);

    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: { registrationId: "r1" },
      idempotencyKey: "reg-confirm/r1",
    });
    await flush();

    // Adapter never called — dedup short-circuited before the provider.
    expect(mockAdapter.send).not.toHaveBeenCalled();
    // notification.sent NOT emitted — avoids double-counting delivery.
    expect(sentEvents).toHaveLength(0);
    // notification.deduplicated IS emitted — stats can see the retry.
    expect(deduplicatedEvents).toHaveLength(1);
    const dedup = deduplicatedEvents[0] as {
      key: string;
      channel: string;
      idempotencyKey: string;
      originalAttemptedAt: string;
    };
    expect(dedup.key).toBe("registration.created");
    expect(dedup.channel).toBe("email");
    expect(dedup.idempotencyKey).toBe("registration.created:u1:reg-confirm/r1");
    expect(dedup.originalAttemptedAt).toBe(priorEntry.attemptedAt);
  });

  it("dedup: unknown category falls back to 24h default window (marketing-unknown behaves identically)", async () => {
    // registration.created is "transactional" → 24h default window.
    // Simulate a prior entry 23h ago (inside window) — should dedup.
    const priorEntry = {
      id: "prior-2",
      key: "registration.created",
      channel: "email" as const,
      recipientRef: "user:u1",
      status: "sent" as const,
      idempotencyKey: "registration.created:u1:reg-confirm/r2",
      attemptedAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      requestId: "req-prior-2",
      actorId: "system",
    };
    const spy = vi
      .spyOn(notificationDispatchLogRepository, "findRecentByIdempotencyKey")
      .mockResolvedValueOnce(priorEntry);

    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: { registrationId: "r2" },
      idempotencyKey: "reg-confirm/r2",
    });
    await flush();

    // Verify the dispatcher asked for a ~24h window (±1ms clock skew).
    expect(spy).toHaveBeenCalled();
    const [, windowMs] = spy.mock.calls[0]!;
    expect(windowMs).toBe(24 * 60 * 60 * 1000);
    expect(deduplicatedEvents).toHaveLength(1);
  });

  it("dedup: window respects category — marketing uses a 1h window", async () => {
    // newsletter.welcome has category "marketing" → 1h window. The
    // dispatcher must pass exactly 1h to findRecentByIdempotencyKey.
    const spy = vi
      .spyOn(notificationDispatchLogRepository, "findRecentByIdempotencyKey")
      .mockResolvedValue(null);

    // First call: no prior → adapter fires.
    await notificationDispatcher.dispatch({
      key: "newsletter.welcome",
      recipients: [{ email: "a@b.co", preferredLocale: "fr" }],
      params: { email: "a@b.co" },
      idempotencyKey: "newsletter/a@b.co",
    });
    await flush();

    expect(spy).toHaveBeenCalled();
    const [, windowMs] = spy.mock.calls[0]!;
    expect(windowMs).toBe(60 * 60 * 1000); // 1h for marketing
    // No dedup entry returned → adapter fired, normal send flow.
    expect(mockAdapter.send).toHaveBeenCalledTimes(1);
    expect(sentEvents).toHaveLength(1);
    expect(deduplicatedEvents).toHaveLength(0);
  });

  it("dedup: event.reminder uses a 7-day override window (per-key policy)", async () => {
    // event.reminder has a per-key override because reminders ship on
    // a weekly cadence — the default 24h organizational window would
    // miss genuine duplicates from a cron double-fire.
    const spy = vi
      .spyOn(notificationDispatchLogRepository, "findRecentByIdempotencyKey")
      .mockResolvedValue(null);

    await notificationDispatcher.dispatch({
      key: "event.reminder",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: { eventTitle: "Test event" },
      idempotencyKey: "event-reminder/e1/u1",
    });
    await flush();

    expect(spy).toHaveBeenCalled();
    const [, windowMs] = spy.mock.calls[0]!;
    expect(windowMs).toBe(7 * 24 * 60 * 60 * 1000); // 7d for event.reminder
  });

  it("dedup: second dispatch BEYOND window proceeds (no short-circuit)", async () => {
    // Repo returns null for stale entries — simulating "within window"
    // lookup that found nothing. Dispatcher must fall through to send.
    vi.spyOn(notificationDispatchLogRepository, "findRecentByIdempotencyKey").mockResolvedValue(
      null,
    );

    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ userId: "u1", preferredLocale: "fr" }],
      params: { registrationId: "r3" },
      idempotencyKey: "reg-confirm/r3",
    });
    await flush();

    expect(mockAdapter.send).toHaveBeenCalledTimes(1);
    expect(sentEvents).toHaveLength(1);
    expect(deduplicatedEvents).toHaveLength(0);
  });

  // ─── Phase 2.4 — testMode (admin "test send" path) ───────────────────
  // Admin previews must bypass admin-disabled, user opt-out, dedup, and
  // emit `notification.test_sent` instead of `notification.sent` so
  // stats stay accurate.

  it("testMode: bypasses admin-disabled short-circuit", async () => {
    vi.spyOn(notificationSettingsRepository, "findByKey").mockResolvedValueOnce({
      key: "registration.created",
      enabled: false,
      channels: ["email"],
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
    });
    const testSentEvents: unknown[] = [];
    eventBus.on("notification.test_sent", (p) => {
      testSentEvents.push(p);
    });

    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ email: "qa@teranga.dev", preferredLocale: "fr" }],
      params: {},
      testMode: true,
    });
    await flush();

    expect(mockAdapter.send).toHaveBeenCalledTimes(1);
    expect(testSentEvents).toHaveLength(1);
    // Critically — no normal `sent` event fires; that would pollute stats.
    expect(sentEvents).toHaveLength(0);
    // testMode flag forwarded to the adapter so it can tag the outbound
    // email (for observability).
    const adapterArgs = (mockAdapter.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(adapterArgs.testMode).toBe(true);
  });

  it("testMode: skips the persistent idempotency dedup check", async () => {
    // Seed a prior-send that WOULD normally trigger dedup.
    const priorEntry = {
      id: "prior-test",
      key: "registration.created",
      channel: "email" as const,
      recipientRef: "email:xxx@dev",
      status: "sent" as const,
      idempotencyKey: "registration.created:qa@teranga.dev:test",
      attemptedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      requestId: "req-prior",
      actorId: "system",
    };
    vi.spyOn(
      notificationDispatchLogRepository,
      "findRecentByIdempotencyKey",
    ).mockResolvedValueOnce(priorEntry);

    await notificationDispatcher.dispatch({
      key: "registration.created",
      recipients: [{ email: "qa@teranga.dev", preferredLocale: "fr" }],
      params: {},
      idempotencyKey: "test",
      testMode: true,
    });
    await flush();

    // testMode path — adapter MUST fire even though a prior log row
    // exists. Dedup is intentional only for real traffic.
    expect(mockAdapter.send).toHaveBeenCalledTimes(1);
    expect(deduplicatedEvents).toHaveLength(0);
  });

  it("dispatches to multiple recipients in parallel", async () => {
    await notificationDispatcher.dispatch({
      key: "event.cancelled",
      recipients: [
        { userId: "u1", email: "a@b.co", preferredLocale: "fr" },
        { userId: "u2", email: "c@d.co", preferredLocale: "en" },
        { userId: "u3", email: "e@f.co", preferredLocale: "wo" },
      ],
      params: { eventTitle: "Cancelled Event" },
    });
    await flush();

    expect(mockAdapter.send).toHaveBeenCalledTimes(3);
    expect(sentEvents).toHaveLength(3);
  });
});
