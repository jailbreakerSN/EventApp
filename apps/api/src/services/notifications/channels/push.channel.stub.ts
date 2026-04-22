import {
  type ChannelAdapter,
  type ChannelCapabilities,
  type ChannelDispatchParams,
  type ChannelDispatchResult,
  type NotificationDefinition,
} from "@teranga/shared-types";
import { registerChannelAdapter } from "../channel-registry";

// ─── Push (FCM) channel stub (Phase 2.6) ───────────────────────────────────
// The real FCM code already exists inside `apps/api/src/services/
// notification.service.ts` (the Firestore + in-app + FCM path). That path
// is orthogonal to the branded notification dispatcher — it powers
// broadcast / direct push use cases from `NotificationService.send`.
//
// TODO(phase-6): port FCM send logic from notification.service.ts into this
// adapter so a single catalog entry with `push` in `defaultChannels` emits
// both a Firestore notification doc (handled by the in-app channel stub
// below) and an FCM push. Until then this stub surfaces the contract
// without doing any I/O.

const PUSH_CAPABILITIES: ChannelCapabilities = {
  attachments: false,
  richText: false,
  maxBodyLength: 0, // FCM doesn't enforce a body length; provider truncates at ~4 KB.
  supportedLocales: [],
};

class PushChannelStub implements ChannelAdapter {
  readonly channel = "push" as const;
  readonly capabilities = PUSH_CAPABILITIES;

  supports(definition: NotificationDefinition): boolean {
    return definition.supportedChannels.includes("push");
  }

  async send(params: ChannelDispatchParams): Promise<ChannelDispatchResult> {
    process.stderr.write(
      JSON.stringify({
        level: "warn",
        event: "push_channel_stub_invoked",
        key: params.definition.key,
        idempotencyKey: params.idempotencyKey,
        note: "Push adapter is a stub — no FCM message sent.",
      }) + "\n",
    );
    return { ok: false, suppressed: "no_recipient" };
  }
}

export const pushChannelStub: ChannelAdapter = new PushChannelStub();

registerChannelAdapter(pushChannelStub);
