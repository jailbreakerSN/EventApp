/**
 * Organizer overhaul — Phase O6.
 *
 * WhatsApp Business channel adapter. The contract is intentionally
 * minimal — `send(request)` accepts a template-bound payload and
 * returns a delivery result with the upstream message id. The default
 * binding is `MockWhatsAppTransport` (no network) until Meta Business
 * homologation aboutit; production will swap in `MetaCloudTransport`
 * via dependency injection at app boot.
 *
 * Why a transport interface (vs. a hard-coded Meta integration):
 *  - **Provider neutrality**: Africa's Talking and Twilio offer
 *    competing WhatsApp gateways. A clean interface lets us swap
 *    providers without rewriting the broadcast service.
 *  - **Test ergonomics**: unit tests exercise the broadcast flow
 *    end-to-end without booting an HTTP mock server.
 *  - **Pre-homologation**: Meta approval cycles are slow; shipping
 *    the rest of the channel (composer toggle, opt-in flow, audit
 *    events) before the real transport is online prevents the
 *    integration from blocking the org-overhaul timeline.
 */

import type {
  WhatsappSendRequest,
  WhatsappSendResult,
  WhatsappTemplate,
} from "@teranga/shared-types";
import { SEED_WHATSAPP_TEMPLATES } from "@teranga/shared-types";

export interface WhatsAppTransport {
  /** Send a template-bound message. Caller MUST verify opt-in first. */
  send(request: WhatsappSendRequest): Promise<WhatsappSendResult>;
}

/**
 * No-network transport used in development + tests. Logs the payload
 * to stderr (mirroring the lifecycle dispatcher's verbose mode) and
 * returns a deterministic mock id (`mock-wa-<random>`). Calling code
 * cannot tell the difference between this and a real send beyond the
 * `mock-` prefix on the message id.
 */
export class MockWhatsAppTransport implements WhatsAppTransport {
  async send(request: WhatsappSendRequest): Promise<WhatsappSendResult> {
    const messageId = `mock-wa-${Math.random().toString(36).slice(2, 12)}`;
    process.stderr.write(
      `[whatsapp:mock] templateId=${request.templateId} to=${request.to} vars=${request.variables.length} → ${messageId}\n`,
    );
    return { messageId, accepted: true };
  }
}

/**
 * Resolves a local template id to its Meta name + variable count.
 * Pure helper — exported for tests so the registry remains the
 * single source of truth (no string-key drift between the seed and
 * the adapter).
 */
export function resolveWhatsappTemplate(templateId: string): WhatsappTemplate | null {
  return SEED_WHATSAPP_TEMPLATES.find((t) => t.id === templateId) ?? null;
}

/**
 * Validate a send request against the resolved template — the variable
 * count must match the template's positional placeholder count. Throws
 * a descriptive error so the broadcast service can surface it as a
 * 400 to the operator (rather than letting Meta return a cryptic
 * `132000` error).
 */
export function validateWhatsappSendRequest(request: WhatsappSendRequest): {
  template: WhatsappTemplate;
} {
  const template = resolveWhatsappTemplate(request.templateId);
  if (!template) {
    throw new Error(`Unknown WhatsApp template id: ${request.templateId}`);
  }
  if (template.status !== "approved") {
    throw new Error(
      `WhatsApp template ${template.id} is ${template.status}; only approved templates can be sent.`,
    );
  }
  if (request.variables.length !== template.variableCount) {
    throw new Error(
      `WhatsApp template ${template.id} expects ${template.variableCount} variable(s), received ${request.variables.length}.`,
    );
  }
  return { template };
}

// Default singleton — production app.ts can rebind to a real transport.
export const whatsappTransport: WhatsAppTransport = new MockWhatsAppTransport();
