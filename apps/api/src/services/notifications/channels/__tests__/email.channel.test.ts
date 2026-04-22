import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NOTIFICATION_CATALOG_BY_KEY } from "@teranga/shared-types";
import {
  setEmailChannelAdapter,
  type EmailChannelAdapter,
} from "../../../notification-dispatcher.service";
import { emailChannel } from "../email.channel";

describe("emailChannel (forward-looking wrapper)", () => {
  const registration = NOTIFICATION_CATALOG_BY_KEY["registration.created"];

  beforeEach(() => {
    // Start every test with no adapter registered so we control the state.
    setEmailChannelAdapter(undefined);
  });

  afterEach(() => {
    setEmailChannelAdapter(undefined);
  });

  it("advertises email capabilities (attachments, richText, unlimited body)", () => {
    expect(emailChannel.channel).toBe("email");
    expect(emailChannel.capabilities.attachments).toBe(true);
    expect(emailChannel.capabilities.richText).toBe(true);
    expect(emailChannel.capabilities.maxBodyLength).toBe(0);
    expect(emailChannel.capabilities.supportedLocales).toEqual([]);
  });

  it("supports() returns false when the legacy adapter is not registered", () => {
    expect(emailChannel.supports(registration)).toBe(false);
  });

  it("supports() returns true when the catalog lists email AND the legacy adapter is registered", () => {
    const legacy: EmailChannelAdapter = { send: vi.fn().mockResolvedValue({ ok: true }) };
    setEmailChannelAdapter(legacy);
    expect(emailChannel.supports(registration)).toBe(true);
  });

  it("send() returns no_recipient suppression when the legacy adapter is missing", async () => {
    const result = await emailChannel.send({
      definition: registration,
      recipient: { userId: "user-1", preferredLocale: "fr" },
      templateParams: {},
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ ok: false, suppressed: "no_recipient" });
  });

  it("send() delegates to the legacy adapter and maps messageId → providerMessageId", async () => {
    const legacy: EmailChannelAdapter = {
      send: vi.fn().mockResolvedValue({ ok: true, messageId: "resend-123" }),
    };
    setEmailChannelAdapter(legacy);

    const result = await emailChannel.send({
      definition: registration,
      recipient: { userId: "user-1", preferredLocale: "fr" },
      templateParams: { eventName: "Test" },
      idempotencyKey: "idem-1",
    });

    expect(legacy.send).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe("resend-123");
  });

  it("send() propagates suppression reasons from the legacy adapter", async () => {
    const legacy: EmailChannelAdapter = {
      send: vi.fn().mockResolvedValue({ ok: false, suppressed: "bounced" }),
    };
    setEmailChannelAdapter(legacy);

    const result = await emailChannel.send({
      definition: registration,
      recipient: { email: "bounce@example.com", preferredLocale: "fr" },
      templateParams: {},
      idempotencyKey: "idem-2",
    });

    expect(result.ok).toBe(false);
    expect(result.suppressed).toBe("bounced");
  });
});
