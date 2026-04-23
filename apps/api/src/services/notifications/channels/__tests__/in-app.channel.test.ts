import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChannelDispatchParams,
  NotificationDefinition,
  NotificationRecipient,
} from "@teranga/shared-types";

// ─── Mock the notification service before the adapter imports it ───────────
// The adapter does a dynamic `import("../../notification.service")` inside
// send(). Vitest's `vi.mock` intercepts the module factory so both the eager
// import (ChannelAdapter → registry wiring) and the lazy dynamic import both
// resolve to the same stub.

// Typed `vi.fn` signatures so `.mock.calls[0]!` resolves to a tuple with
// elements rather than `never[]` (strict TS). We only care about the
// argument shapes the adapter actually passes.
type WriteInAppDocInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageURL: string | null;
  isTestSend?: boolean;
};
type SendFcmInput = {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageURL: string | null;
};
const writeInAppDoc = vi.fn(async (_input: WriteInAppDocInput) => "notif-doc-42");
const sendFcmToUser = vi.fn(async (_userId: string, _payload: SendFcmInput) => undefined);

vi.mock("@/services/notification.service", () => ({
  notificationService: {
    writeInAppDoc,
    sendFcmToUser,
  },
}));

// Also register a no-op registry — the adapter self-registers on import.
// Without this the real registry would be written by the import, which is
// harmless but noisy across suites.
vi.mock("@/services/notifications/channel-registry", () => ({
  registerChannelAdapter: vi.fn(),
  getChannelAdapter: vi.fn(),
  listChannelAdapters: vi.fn(() => []),
}));

// Now import the adapter — after the mocks are in place.
import { inAppChannelAdapter } from "../in-app.channel";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const baseDefinition: NotificationDefinition = {
  key: "registration.created",
  category: "transactional",
  displayName: { fr: "Inscription confirmée", en: "Registration confirmed", wo: "Bindu wéralu na" },
  description: {
    fr: "Votre inscription est confirmée.",
    en: "Your registration is confirmed.",
    wo: "Sa bindu wéralu na.",
  },
  supportedChannels: ["email", "in_app"],
  defaultChannels: ["email", "in_app"],
  userOptOutAllowed: false,
  templates: { email: "RegistrationConfirmation" },
  triggerDomainEvent: "registration.created",
  recipientResolver: "self",
  scope: "event",
};

function buildParams(
  overrides: Partial<ChannelDispatchParams> = {},
): ChannelDispatchParams {
  const recipient: NotificationRecipient = {
    userId: "user-1",
    preferredLocale: "fr",
    ...(overrides.recipient ?? {}),
  };
  return {
    definition: overrides.definition ?? baseDefinition,
    recipient,
    templateParams: overrides.templateParams ?? {},
    idempotencyKey: overrides.idempotencyKey ?? "registration.created:user-1:reg-1",
    testMode: overrides.testMode,
  };
}

beforeEach(() => {
  writeInAppDoc.mockClear();
  sendFcmToUser.mockClear();
  writeInAppDoc.mockResolvedValue("notif-doc-42");
  sendFcmToUser.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("inAppChannelAdapter", () => {
  it("advertises the in_app channel + correct capabilities", () => {
    expect(inAppChannelAdapter.channel).toBe("in_app");
    expect(inAppChannelAdapter.capabilities.attachments).toBe(false);
    expect(inAppChannelAdapter.capabilities.richText).toBe(true);
    expect(inAppChannelAdapter.capabilities.maxBodyLength).toBe(0);
  });

  it("supports() returns true when in_app is in supportedChannels", () => {
    expect(inAppChannelAdapter.supports(baseDefinition)).toBe(true);
  });

  it("supports() returns false when in_app is not in supportedChannels", () => {
    const emailOnly: NotificationDefinition = {
      ...baseDefinition,
      supportedChannels: ["email"],
    };
    expect(inAppChannelAdapter.supports(emailOnly)).toBe(false);
  });

  it("send() writes the Firestore doc with the locale-resolved title + body", async () => {
    const result = await inAppChannelAdapter.send(buildParams());

    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe("notif-doc-42");

    expect(writeInAppDoc).toHaveBeenCalledTimes(1);
    const call = writeInAppDoc.mock.calls[0]![0];
    expect(call.userId).toBe("user-1");
    expect(call.title).toBe("Inscription confirmée");
    expect(call.body).toBe("Votre inscription est confirmée.");
  });

  it("send() falls back to French when the recipient's locale is missing from i18n", async () => {
    // Build a definition where the Wolof key is literally absent so the
    // fallback path exercises. (In practice every catalog entry carries all
    // three locales, but the adapter must not trust that.)
    const partial: NotificationDefinition = {
      ...baseDefinition,
      displayName: { fr: "Inscription FR", en: "Registration EN" } as never,
      description: { fr: "Corps FR", en: "Body EN" } as never,
    };

    const result = await inAppChannelAdapter.send(
      buildParams({
        definition: partial,
        recipient: { userId: "user-1", preferredLocale: "wo" },
      }),
    );

    expect(result.ok).toBe(true);
    const call = writeInAppDoc.mock.calls[0]![0];
    expect(call.title).toBe("Inscription FR");
    expect(call.body).toBe("Corps FR");
  });

  it("send() prefers templateParams.title / .body overrides when provided", async () => {
    await inAppChannelAdapter.send(
      buildParams({
        templateParams: {
          title: "Override titre",
          body: "Override corps",
        },
      }),
    );

    const call = writeInAppDoc.mock.calls[0]![0];
    expect(call.title).toBe("Override titre");
    expect(call.body).toBe("Override corps");
  });

  it("send() copies plain-string templateParams.data into the Firestore doc", async () => {
    await inAppChannelAdapter.send(
      buildParams({
        templateParams: {
          data: { eventId: "event-1", deepLink: "/events/event-1", ignored: { nested: true } },
        },
      }),
    );

    const call = writeInAppDoc.mock.calls[0]![0];
    expect(call.data).toEqual({ eventId: "event-1", deepLink: "/events/event-1" });
  });

  it("send() fires FCM to the recipient after the Firestore write", async () => {
    await inAppChannelAdapter.send(buildParams());

    expect(sendFcmToUser).toHaveBeenCalledTimes(1);
    const [userId, payload] = sendFcmToUser.mock.calls[0]!;
    expect(userId).toBe("user-1");
    expect(payload.title).toBe("Inscription confirmée");
    expect(payload.body).toBe("Votre inscription est confirmée.");
  });

  it("send() tags the doc with isTestSend when testMode is true", async () => {
    await inAppChannelAdapter.send(buildParams({ testMode: true }));

    const call = writeInAppDoc.mock.calls[0]![0];
    expect(call.isTestSend).toBe(true);
  });

  it("send() suppresses with no_recipient when recipient has no userId", async () => {
    const params = buildParams();
    // Build a recipient WITHOUT userId — a plain spread-with-undefined
    // won't strip it, so we construct directly.
    const result = await inAppChannelAdapter.send({
      ...params,
      recipient: { email: "a@b.co", preferredLocale: "fr" },
    });
    expect(result).toEqual({ ok: false, suppressed: "no_recipient" });
    expect(writeInAppDoc).not.toHaveBeenCalled();
    expect(sendFcmToUser).not.toHaveBeenCalled();
  });

  it("send() returns suppressed='bounced' when writeInAppDoc throws", async () => {
    writeInAppDoc.mockRejectedValueOnce(new Error("Firestore unavailable"));
    // Capture the structured stderr log without polluting the test output.
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as typeof process.stderr.write);

    const result = await inAppChannelAdapter.send(buildParams());

    expect(result).toEqual({ ok: false, suppressed: "bounced" });
    expect(sendFcmToUser).not.toHaveBeenCalled();
    const logged = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(logged).toContain("in_app_channel.send_error");
    expect(logged).toContain("Firestore unavailable");
    stderrSpy.mockRestore();
  });

  it("send() maps the catalog key to a stable NotificationType enum", async () => {
    // registration.created → "registration_confirmed" per the adapter's map.
    await inAppChannelAdapter.send(buildParams());
    expect(writeInAppDoc.mock.calls[0]![0].type).toBe("registration_confirmed");

    // Unmapped keys fall back to "system".
    writeInAppDoc.mockClear();
    const unmapped: NotificationDefinition = {
      ...baseDefinition,
      key: "some.future.key",
    };
    await inAppChannelAdapter.send(buildParams({ definition: unmapped }));
    expect(writeInAppDoc.mock.calls[0]![0].type).toBe("system");
  });
});
