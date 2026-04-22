import {
  type ChannelAdapter,
  type ChannelCapabilities,
  type ChannelDispatchParams,
  type ChannelDispatchResult,
  type NotificationDefinition,
} from "@teranga/shared-types";
import {
  getEmailChannelAdapter,
  type EmailChannelAdapter,
} from "../../notification-dispatcher.service";
import { registerChannelAdapter } from "../channel-registry";

// ─── Email channel (Phase 2.6) ─────────────────────────────────────────────
// Thin forward-looking wrapper around the legacy `EmailChannelAdapter`
// registered by `apps/api/src/services/email/dispatcher-adapter.ts`. We do
// NOT re-register or replace that adapter — the live dispatcher still
// consumes it through `notification-dispatcher.service.ts#adapters.email`.
//
// Purpose: exercise the new `ChannelAdapter` contract end-to-end so SMS /
// push / in_app stubs have a real sibling to model themselves after. Phase 3
// will fold the two registrations into one and delete the legacy pathway.

const EMAIL_CAPABILITIES: ChannelCapabilities = {
  attachments: true,
  richText: true,
  maxBodyLength: 0, // unlimited
  supportedLocales: [], // empty = every catalog locale (fr / en / wo)
};

class EmailChannel implements ChannelAdapter {
  readonly channel = "email" as const;
  readonly capabilities = EMAIL_CAPABILITIES;

  supports(definition: NotificationDefinition): boolean {
    // Email is supported whenever the catalog lists it and the legacy
    // adapter is actually registered (guards against boot-ordering bugs).
    return (
      definition.supportedChannels.includes("email") &&
      getEmailChannelAdapter() !== undefined
    );
  }

  async send(params: ChannelDispatchParams): Promise<ChannelDispatchResult> {
    const legacy: EmailChannelAdapter | undefined = getEmailChannelAdapter();
    if (!legacy) {
      // The email dispatcher-adapter module hasn't been imported yet (or
      // tests called setEmailChannelAdapter(undefined)). Fail-closed with a
      // no_recipient suppression; never throw.
      return { ok: false, suppressed: "no_recipient" };
    }

    const legacyResult = await legacy.send({
      definition: params.definition,
      recipient: params.recipient,
      templateParams: params.templateParams,
      idempotencyKey: params.idempotencyKey,
    });

    return {
      ok: legacyResult.ok,
      providerMessageId: legacyResult.messageId,
      suppressed: legacyResult.suppressed,
    };
  }
}

export const emailChannel: ChannelAdapter = new EmailChannel();

// Register in the forward-looking registry on import. Safe to call more
// than once — registerChannelAdapter overwrites by design.
registerChannelAdapter(emailChannel);
