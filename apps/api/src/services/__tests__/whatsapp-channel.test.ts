import { describe, it, expect } from "vitest";
import {
  MockWhatsAppTransport,
  resolveWhatsappTemplate,
  validateWhatsappSendRequest,
} from "../whatsapp.channel";
import { SEED_WHATSAPP_TEMPLATES } from "@teranga/shared-types";

// ─── WhatsApp channel adapter — pure helpers + transport contract ─────────
//
// Phase O6: the transport interface is the seam where the real Meta
// Cloud client will land. Tests pin the helper guards (template
// resolution, variable count, status) so a future provider swap can't
// silently regress the contract.

describe("resolveWhatsappTemplate", () => {
  it("returns the matching template by id", () => {
    const t = resolveWhatsappTemplate("wa-reminder-j1");
    expect(t).not.toBeNull();
    expect(t?.metaName).toBe("teranga_reminder_j1_fr");
    expect(t?.variableCount).toBe(3);
  });

  it("returns null on unknown id", () => {
    expect(resolveWhatsappTemplate("unknown-template")).toBeNull();
  });

  it("seed registry is non-empty (sanity check)", () => {
    expect(SEED_WHATSAPP_TEMPLATES.length).toBeGreaterThan(0);
  });
});

describe("validateWhatsappSendRequest", () => {
  it("accepts a request matching the template's variable count", () => {
    const out = validateWhatsappSendRequest({
      templateId: "wa-reminder-j1",
      to: "+221700000000",
      variables: ["Fatou", "Atelier Tech", "12 mai 2026"],
    });
    expect(out.template.id).toBe("wa-reminder-j1");
  });

  it("rejects an unknown template id", () => {
    expect(() =>
      validateWhatsappSendRequest({
        templateId: "no-such-template",
        to: "+221700000000",
        variables: [],
      }),
    ).toThrow(/Unknown WhatsApp template/);
  });

  it("rejects a request whose variable count does not match the template", () => {
    expect(() =>
      validateWhatsappSendRequest({
        templateId: "wa-reminder-j1",
        to: "+221700000000",
        variables: ["only-one-var"], // template expects 3
      }),
    ).toThrow(/expects 3 variable\(s\), received 1/);
  });
});

describe("MockWhatsAppTransport.send", () => {
  it("returns a deterministic mock id with the `mock-wa-` prefix", async () => {
    const transport = new MockWhatsAppTransport();
    const result = await transport.send({
      templateId: "wa-reminder-j1",
      to: "+221700000000",
      variables: ["Fatou", "Atelier Tech", "12 mai 2026"],
    });
    expect(result.accepted).toBe(true);
    expect(result.messageId.startsWith("mock-wa-")).toBe(true);
  });

  it("yields fresh ids on each invocation (no collision)", async () => {
    const transport = new MockWhatsAppTransport();
    const a = await transport.send({
      templateId: "wa-reminder-j1",
      to: "+221700000000",
      variables: ["a", "b", "c"],
    });
    const b = await transport.send({
      templateId: "wa-reminder-j1",
      to: "+221700000000",
      variables: ["a", "b", "c"],
    });
    expect(a.messageId).not.toBe(b.messageId);
  });
});
