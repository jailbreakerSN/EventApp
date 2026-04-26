import { describe, it, expect } from "vitest";
import { formatPaymentMethod, formatPaymentStatus, formatXof } from "../helpers";

// ─── Post-event helpers — pure utilities ──────────────────────────────────
//
// These helpers feed both the JSX cards + the reconciliation table.
// They are pure (no DOM, no Intl edge cases) so we pin every input.

describe("formatXof", () => {
  it("emits regular spaces (not narrow no-break) as thousands separators", () => {
    const out = formatXof(1234567);
    expect(out).toBe("1 234 567 XOF");
    // No U+202F (narrow no-break space) or U+00A0 (no-break space) —
    // they would be consumed by the PDF renderer too, which can't
    // encode those. We use unicode escapes here to keep the file
    // readable in any editor that hides exotic whitespace.
    expect(out).not.toMatch(/[\u00a0\u2009\u202f]/);
  });

  it("renders 0 without leading sign", () => {
    expect(formatXof(0)).toBe("0 XOF");
  });

  it("clamps negative input to 0 (UI never shows negative XOF)", () => {
    expect(formatXof(-1234)).toBe("0 XOF");
  });

  it("rounds non-integer input (XOF has no decimals)", () => {
    expect(formatXof(1234.7)).toBe("1 235 XOF");
  });
});

describe("formatPaymentMethod", () => {
  it("maps known providers to their display label", () => {
    expect(formatPaymentMethod("wave")).toBe("Wave");
    expect(formatPaymentMethod("orange_money")).toBe("Orange Money");
    expect(formatPaymentMethod("free_money")).toBe("Free Money");
    expect(formatPaymentMethod("mock")).toBe("Mock (test)");
  });

  it("returns the raw value for unknown methods (forward-compat)", () => {
    expect(formatPaymentMethod("future_provider")).toBe("future_provider");
  });
});

describe("formatPaymentStatus", () => {
  it("maps the 6 PaymentStatus values to FR labels", () => {
    // Mirror of PaymentStatusSchema in @teranga/shared-types.
    expect(formatPaymentStatus("pending")).toBe("En attente");
    expect(formatPaymentStatus("processing")).toBe("En cours");
    expect(formatPaymentStatus("succeeded")).toBe("Succès");
    expect(formatPaymentStatus("failed")).toBe("Échec");
    expect(formatPaymentStatus("refunded")).toBe("Remboursé");
    expect(formatPaymentStatus("expired")).toBe("Expiré");
  });

  it("returns the raw value on unknown status (forward-compat, no throw)", () => {
    expect(formatPaymentStatus("disputed")).toBe("disputed");
  });
});
