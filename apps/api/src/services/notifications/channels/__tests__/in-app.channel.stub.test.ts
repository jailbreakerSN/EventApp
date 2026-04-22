import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NOTIFICATION_CATALOG_BY_KEY } from "@teranga/shared-types";
import { inAppChannelStub } from "../in-app.channel.stub";

describe("inAppChannelStub", () => {
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

  it("advertises in-app rich-text capabilities", () => {
    expect(inAppChannelStub.channel).toBe("in_app");
    expect(inAppChannelStub.capabilities.attachments).toBe(false);
    expect(inAppChannelStub.capabilities.richText).toBe(true);
    expect(inAppChannelStub.capabilities.maxBodyLength).toBe(0);
  });

  it("supports() returns false when the catalog entry does not list in_app", () => {
    expect(inAppChannelStub.supports(registration)).toBe(false);
  });

  it("supports() returns true when the catalog entry lists in_app", () => {
    const withInApp = {
      ...registration,
      supportedChannels: [...registration.supportedChannels, "in_app" as const],
    };
    expect(inAppChannelStub.supports(withInApp)).toBe(true);
  });

  it("send() returns no_recipient suppression and logs the stub invocation", async () => {
    const result = await inAppChannelStub.send({
      definition: registration,
      recipient: { userId: "user-1", preferredLocale: "fr" },
      templateParams: {},
      idempotencyKey: "idem-in-app-1",
    });

    expect(result).toEqual({ ok: false, suppressed: "no_recipient" });
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain(
      "in_app_channel_stub_invoked",
    );
  });
});
