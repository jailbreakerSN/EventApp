import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NOTIFICATION_CATALOG_BY_KEY } from "@teranga/shared-types";
import { smsChannelStub } from "../sms.channel.stub";

describe("smsChannelStub", () => {
  const reminder = NOTIFICATION_CATALOG_BY_KEY["event.reminder"];
  let stderrSpy: ReturnType<typeof vi.fn>;
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrSpy = vi.fn().mockReturnValue(true);
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  it("advertises the 160-char GSM-7 SMS capability profile", () => {
    expect(smsChannelStub.channel).toBe("sms");
    expect(smsChannelStub.capabilities.attachments).toBe(false);
    expect(smsChannelStub.capabilities.richText).toBe(false);
    expect(smsChannelStub.capabilities.maxBodyLength).toBe(160);
  });

  it("supports() returns false for a catalog entry that does NOT list sms", () => {
    // All current catalog entries ship email only.
    expect(smsChannelStub.supports(reminder)).toBe(false);
  });

  it("supports() returns true when the catalog lists sms", () => {
    const withSms = {
      ...reminder,
      supportedChannels: [...reminder.supportedChannels, "sms" as const],
    };
    expect(smsChannelStub.supports(withSms)).toBe(true);
  });

  it("send() returns no_recipient suppression and logs a stub-invoked warning", async () => {
    const result = await smsChannelStub.send({
      definition: reminder,
      recipient: { phone: "+221700000000", preferredLocale: "fr" },
      templateParams: {},
      idempotencyKey: "idem-sms-1",
    });

    expect(result).toEqual({ ok: false, suppressed: "no_recipient" });
    expect(stderrSpy).toHaveBeenCalledOnce();
    const logged = String(stderrSpy.mock.calls[0]?.[0]);
    expect(logged).toContain("sms_channel_stub_invoked");
    expect(logged).toContain(reminder.key);
  });
});
