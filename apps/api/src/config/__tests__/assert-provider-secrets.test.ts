import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkProviderSecrets,
  assertProviderSecrets,
} from "../assert-provider-secrets";

// P1-18 (audit L3) — boot-time assertion contract.

describe("checkProviderSecrets", () => {
  it("returns ok=true when no provider is configured (dev posture)", () => {
    const result = checkProviderSecrets({
      env: { NODE_ENV: "development" },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // ── Wave ──────────────────────────────────────────────────────────────────
  it("returns ok=true when WAVE_API_KEY + WAVE_API_SECRET are both set", () => {
    const result = checkProviderSecrets({
      env: { WAVE_API_KEY: "k", WAVE_API_SECRET: "s" },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok=false with a Wave-specific error when WAVE_API_KEY is set but the secret is missing", () => {
    const result = checkProviderSecrets({
      env: { WAVE_API_KEY: "k" },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("wave");
    expect(result.errors[0]).toContain("WAVE_API_SECRET");
    // Operator hint must surface so it's clear *why* this is fatal.
    expect(result.errors[0]).toContain("HMAC signatures");
  });

  it("treats an empty-string WAVE_API_SECRET as unset (the original L3 footgun)", () => {
    const result = checkProviderSecrets({
      env: { WAVE_API_KEY: "k", WAVE_API_SECRET: "   " },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("WAVE_API_SECRET");
  });

  // ── Orange Money ──────────────────────────────────────────────────────────
  it("returns ok=true when all four OM env vars are set", () => {
    const result = checkProviderSecrets({
      env: {
        ORANGE_MONEY_CLIENT_ID: "ci",
        ORANGE_MONEY_CLIENT_SECRET: "cs",
        ORANGE_MONEY_MERCHANT_KEY: "mk",
        ORANGE_MONEY_NOTIF_TOKEN: "nt",
      },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(true);
  });

  it("flags every missing companion var in the OM error message", () => {
    const result = checkProviderSecrets({
      env: { ORANGE_MONEY_CLIENT_ID: "ci" },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    const msg = result.errors[0];
    expect(msg).toContain("ORANGE_MONEY_CLIENT_SECRET");
    expect(msg).toContain("ORANGE_MONEY_MERCHANT_KEY");
    expect(msg).toContain("ORANGE_MONEY_NOTIF_TOKEN");
  });

  it("flags partial OM config (some vars set, others missing)", () => {
    const result = checkProviderSecrets({
      env: {
        ORANGE_MONEY_CLIENT_ID: "ci",
        ORANGE_MONEY_CLIENT_SECRET: "cs",
        ORANGE_MONEY_MERCHANT_KEY: "mk",
        // notif_token still missing → webhook verify silently fails
      },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("ORANGE_MONEY_NOTIF_TOKEN");
    expect(result.errors[0]).not.toContain("ORANGE_MONEY_CLIENT_SECRET");
  });

  // ── Cross-provider isolation ──────────────────────────────────────────────
  it("reports both Wave and OM errors when both are half-configured", () => {
    const result = checkProviderSecrets({
      env: {
        WAVE_API_KEY: "k",
        ORANGE_MONEY_CLIENT_ID: "ci",
      },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.some((e) => e.includes("wave"))).toBe(true);
    expect(result.errors.some((e) => e.includes("orange_money"))).toBe(true);
  });

  // ── PAYMENT_WEBHOOK_SECRET ────────────────────────────────────────────────
  it("requires PAYMENT_WEBHOOK_SECRET in production", () => {
    const result = checkProviderSecrets({
      env: { NODE_ENV: "production" },
      nodeEnv: "production",
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("PAYMENT_WEBHOOK_SECRET");
  });

  it("does not require PAYMENT_WEBHOOK_SECRET outside production", () => {
    const result = checkProviderSecrets({
      env: {},
      nodeEnv: "development",
    });
    expect(result.ok).toBe(true);
  });

  // ── Warnings on missing webhook IP allowlists in production ───────────────
  it("warns (not errors) when production lacks webhook IP allowlists", () => {
    const result = checkProviderSecrets({
      env: { PAYMENT_WEBHOOK_SECRET: "s" },
      nodeEnv: "production",
    });
    expect(result.ok).toBe(true); // warnings don't fail the boot
    expect(result.warnings.some((w) => w.includes("WAVE_WEBHOOK_IPS"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("OM_WEBHOOK_IPS"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("PAYDUNYA_WEBHOOK_IPS"))).toBe(true);
  });
});

describe("assertProviderSecrets", () => {
  // Inferred type — explicit annotation conflicts with the spyOn
  // overloads on `process.stderr.write` (string | Uint8Array variants).
  let stderrSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    stderrSpy?.mockRestore();
  });

  it("does NOT throw on a valid configuration", () => {
    expect(() =>
      assertProviderSecrets({
        env: { WAVE_API_KEY: "k", WAVE_API_SECRET: "s" },
        nodeEnv: "development",
      }),
    ).not.toThrow();
  });

  it("THROWS with the concatenated error list when half-configured", () => {
    let caught: unknown;
    try {
      assertProviderSecrets({
        env: { WAVE_API_KEY: "k" },
        nodeEnv: "development",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("Boot aborted");
    expect((caught as Error).message).toContain("wave");
    expect((caught as Error).message).toContain("WAVE_API_SECRET");
  });

  it("emits warnings to stderr but does NOT throw on a warning-only result", () => {
    expect(() =>
      assertProviderSecrets({
        env: { PAYMENT_WEBHOOK_SECRET: "s" },
        nodeEnv: "production",
      }),
    ).not.toThrow();
    const stderrOutput = (stderrSpy?.mock.calls ?? []).flat().join("");
    expect(stderrOutput).toContain("WAVE_WEBHOOK_IPS");
    expect(stderrOutput).toContain("provider_secret_warning");
  });
});
