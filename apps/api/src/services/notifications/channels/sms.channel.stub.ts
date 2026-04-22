import {
  type ChannelAdapter,
  type ChannelCapabilities,
  type ChannelDispatchParams,
  type ChannelDispatchResult,
  type NotificationDefinition,
} from "@teranga/shared-types";
import { registerChannelAdapter } from "../channel-registry";

// ─── SMS channel stub (Phase 2.6) ──────────────────────────────────────────
// Scaffolding only — exercises the ChannelAdapter contract so Phase 6 can
// swap the stub for a real provider (Africa's Talking for Senegal / Wave +
// Orange Money footprint) without a dispatcher-level rewrite.
//
// Capabilities mirror the GSM-7 160-char SMS segment: attachments=false,
// richText=false, maxBodyLength=160. Long-body templates split into
// multi-segment SMS are a Phase 6 concern — the catalog will grow a
// per-channel body template at that point.
//
// TODO(phase-6): wire Africa's Talking.
//   - Read API key + sender id from GCP Secret Manager.
//   - Replace the stub send() with the real REST call.
//   - Surface costXofMicro from the provider's `cost` field.

const SMS_CAPABILITIES: ChannelCapabilities = {
  attachments: false,
  richText: false,
  maxBodyLength: 160,
  supportedLocales: [],
};

class SmsChannelStub implements ChannelAdapter {
  readonly channel = "sms" as const;
  readonly capabilities = SMS_CAPABILITIES;

  supports(definition: NotificationDefinition): boolean {
    return definition.supportedChannels.includes("sms");
  }

  async send(params: ChannelDispatchParams): Promise<ChannelDispatchResult> {
    // Keep the stub visible in logs without throwing. Phase 6 replaces this
    // with a real provider call.
    process.stderr.write(
      JSON.stringify({
        level: "warn",
        event: "sms_channel_stub_invoked",
        key: params.definition.key,
        idempotencyKey: params.idempotencyKey,
        note: "SMS adapter is a stub — no message sent.",
      }) + "\n",
    );
    return { ok: false, suppressed: "no_recipient" };
  }
}

export const smsChannelStub: ChannelAdapter = new SmsChannelStub();

registerChannelAdapter(smsChannelStub);
