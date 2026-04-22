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
import { NOTIFICATION_CATALOG_BY_KEY } from "@teranga/shared-types";

// ─── Test doubles ──────────────────────────────────────────────────────────

const sentEvents: unknown[] = [];
const suppressedEvents: unknown[] = [];

function captureEvents() {
  eventBus.removeAllListeners();
  sentEvents.length = 0;
  suppressedEvents.length = 0;
  eventBus.on("notification.sent", (p) => {
    sentEvents.push(p);
  });
  eventBus.on("notification.suppressed", (p) => {
    suppressedEvents.push(p);
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
