import { describe, it, expect, beforeEach } from "vitest";
import {
  type ChannelAdapter,
  type ChannelCapabilities,
  type NotificationDefinition,
} from "@teranga/shared-types";
import {
  registerChannelAdapter,
  getChannelAdapter,
  listChannelAdapters,
  __resetChannelRegistryForTests,
} from "../channel-registry";

function buildAdapter(
  channel: ChannelAdapter["channel"],
  id: string,
): ChannelAdapter {
  const capabilities: ChannelCapabilities = {
    attachments: false,
    richText: false,
    maxBodyLength: 0,
    supportedLocales: [],
  };
  return {
    channel,
    capabilities,
    supports: (_def: NotificationDefinition) => true,
    send: async () => ({ ok: true, providerMessageId: id }),
  };
}

describe("channel-registry", () => {
  beforeEach(() => {
    __resetChannelRegistryForTests();
  });

  it("register + get round-trips", () => {
    const adapter = buildAdapter("sms", "sms-a");
    registerChannelAdapter(adapter);
    expect(getChannelAdapter("sms")).toBe(adapter);
  });

  it("returns undefined for a channel that was never registered", () => {
    expect(getChannelAdapter("push")).toBeUndefined();
  });

  it("overwrites a previously-registered adapter for the same channel", () => {
    const first = buildAdapter("sms", "sms-v1");
    const second = buildAdapter("sms", "sms-v2");
    registerChannelAdapter(first);
    registerChannelAdapter(second);
    expect(getChannelAdapter("sms")).toBe(second);
    expect(getChannelAdapter("sms")).not.toBe(first);
  });

  it("listChannelAdapters returns every registered adapter", () => {
    registerChannelAdapter(buildAdapter("email", "email-1"));
    registerChannelAdapter(buildAdapter("sms", "sms-1"));
    const all = listChannelAdapters();
    const channels = all.map((a) => a.channel).sort();
    expect(channels).toEqual(["email", "sms"]);
  });

  it("__resetChannelRegistryForTests clears the registry", () => {
    registerChannelAdapter(buildAdapter("push", "push-1"));
    expect(listChannelAdapters()).toHaveLength(1);
    __resetChannelRegistryForTests();
    expect(listChannelAdapters()).toHaveLength(0);
  });
});
