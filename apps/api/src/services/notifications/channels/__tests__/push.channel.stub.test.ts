import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NOTIFICATION_CATALOG_BY_KEY } from "@teranga/shared-types";
import { pushChannelStub } from "../push.channel.stub";

describe("pushChannelStub", () => {
  const registration = NOTIFICATION_CATALOG_BY_KEY["registration.created"];
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

  it("advertises FCM-friendly capabilities (no attachments, no rich text, no enforced body cap)", () => {
    expect(pushChannelStub.channel).toBe("push");
    expect(pushChannelStub.capabilities.attachments).toBe(false);
    expect(pushChannelStub.capabilities.richText).toBe(false);
    expect(pushChannelStub.capabilities.maxBodyLength).toBe(0);
  });

  it("supports() returns false when the catalog entry does not list push", () => {
    expect(pushChannelStub.supports(registration)).toBe(false);
  });

  it("supports() returns true when the catalog entry lists push", () => {
    const withPush = {
      ...registration,
      supportedChannels: [...registration.supportedChannels, "push" as const],
    };
    expect(pushChannelStub.supports(withPush)).toBe(true);
  });

  it("send() returns no_recipient suppression and logs the stub invocation", async () => {
    const result = await pushChannelStub.send({
      definition: registration,
      recipient: {
        userId: "user-1",
        fcmTokens: ["fake-token"],
        preferredLocale: "fr",
      },
      templateParams: {},
      idempotencyKey: "idem-push-1",
    });

    expect(result).toEqual({ ok: false, suppressed: "no_recipient" });
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain(
      "push_channel_stub_invoked",
    );
  });
});
