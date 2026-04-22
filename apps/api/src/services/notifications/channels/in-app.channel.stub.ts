import {
  type ChannelAdapter,
  type ChannelCapabilities,
  type ChannelDispatchParams,
  type ChannelDispatchResult,
  type NotificationDefinition,
} from "@teranga/shared-types";
import { registerChannelAdapter } from "../channel-registry";

// ─── In-app channel stub (Phase 2.6) ───────────────────────────────────────
// In-app writes (Firestore `notifications/{id}` docs) already happen inside
// `apps/api/src/services/notification.service.ts`. That service is invoked
// directly by listeners today, side-stepping the branded-notification
// dispatcher entirely.
//
// TODO(phase-6): move the Firestore write into this adapter so a catalog
// entry with `in_app` in `defaultChannels` produces a user-facing
// notification doc through the dispatcher pipeline (and therefore gets
// per-key / per-channel preference gating + audit logging for free).
//
// Capabilities: richText=true (client renders via the shared-ui card),
// attachments=false, no explicit length cap (clients truncate).

const IN_APP_CAPABILITIES: ChannelCapabilities = {
  attachments: false,
  richText: true,
  maxBodyLength: 0,
  supportedLocales: [],
};

class InAppChannelStub implements ChannelAdapter {
  readonly channel = "in_app" as const;
  readonly capabilities = IN_APP_CAPABILITIES;

  supports(definition: NotificationDefinition): boolean {
    return definition.supportedChannels.includes("in_app");
  }

  async send(params: ChannelDispatchParams): Promise<ChannelDispatchResult> {
    process.stderr.write(
      JSON.stringify({
        level: "warn",
        event: "in_app_channel_stub_invoked",
        key: params.definition.key,
        idempotencyKey: params.idempotencyKey,
        note: "In-app adapter is a stub — no Firestore doc written via dispatcher.",
      }) + "\n",
    );
    return { ok: false, suppressed: "no_recipient" };
  }
}

export const inAppChannelStub: ChannelAdapter = new InAppChannelStub();

registerChannelAdapter(inAppChannelStub);
