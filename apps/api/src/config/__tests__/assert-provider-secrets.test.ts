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

  // ── PayDunya (Phase 2) ────────────────────────────────────────────────────
  it("returns ok=true when all 3 PayDunya env vars are set", () => {
    const result = checkProviderSecrets({
      env: {
        PAYDUNYA_MASTER_KEY: "mk",
        PAYDUNYA_PRIVATE_KEY: "pk",
        PAYDUNYA_TOKEN: "tk",
      },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(true);
  });

  it("flags every missing PayDunya companion var", () => {
    const result = checkProviderSecrets({
      env: { PAYDUNYA_MASTER_KEY: "mk" },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    const msg = result.errors[0];
    expect(msg).toContain("paydunya");
    expect(msg).toContain("PAYDUNYA_PRIVATE_KEY");
    expect(msg).toContain("PAYDUNYA_TOKEN");
    // Operator hint must call out the silent-failure mode (initiate
    // 401s while webhook verify still works, so the provider looks
    // healthy from one angle).
    expect(msg).toContain("MasterKey alone");
  });

  it("flags partial PayDunya config (some companions set, others missing)", () => {
    const result = checkProviderSecrets({
      env: {
        PAYDUNYA_MASTER_KEY: "mk",
        PAYDUNYA_PRIVATE_KEY: "pk",
        // PAYDUNYA_TOKEN missing
      },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("PAYDUNYA_TOKEN");
    expect(result.errors[0]).not.toContain("PAYDUNYA_PRIVATE_KEY");
  });

  it("treats empty-string PayDunya secrets as unset (the L3 footgun)", () => {
    const result = checkProviderSecrets({
      env: {
        PAYDUNYA_MASTER_KEY: "mk",
        PAYDUNYA_PRIVATE_KEY: "",
        PAYDUNYA_TOKEN: "  ",
      },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("PAYDUNYA_PRIVATE_KEY");
    expect(result.errors[0]).toContain("PAYDUNYA_TOKEN");
  });

  it("reports Wave + OM + PayDunya errors when all three are half-configured", () => {
    const result = checkProviderSecrets({
      env: {
        WAVE_API_KEY: "k",
        ORANGE_MONEY_CLIENT_ID: "ci",
        PAYDUNYA_MASTER_KEY: "mk",
      },
      nodeEnv: "development",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.some((e) => e.includes("wave"))).toBe(true);
    expect(result.errors.some((e) => e.includes("orange_money"))).toBe(true);
    expect(result.errors.some((e) => e.includes("paydunya"))).toBe(true);
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
  it("warns (not errors) for ENABLED providers that lack a webhook IP allowlist", () => {
    // Phase-2 audit follow-up: warnings only fire for providers
    // that are actually configured (their trigger var is set).
    // This test enables ALL three to verify the full warning set.
    const result = checkProviderSecrets({
      env: {
        PAYMENT_WEBHOOK_SECRET: "s",
        WAVE_API_KEY: "wk",
        WAVE_API_SECRET: "ws",
        ORANGE_MONEY_CLIENT_ID: "ci",
        ORANGE_MONEY_CLIENT_SECRET: "cs",
        ORANGE_MONEY_MERCHANT_KEY: "mk",
        ORANGE_MONEY_NOTIF_TOKEN: "nt",
        PAYDUNYA_MASTER_KEY: "pmk",
        PAYDUNYA_PRIVATE_KEY: "ppk",
        PAYDUNYA_TOKEN: "pt",
      },
      nodeEnv: "production",
    });
    expect(result.ok).toBe(true); // warnings don't fail the boot
    expect(result.warnings.some((w) => w.includes("WAVE_WEBHOOK_IPS"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("OM_WEBHOOK_IPS"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("PAYDUNYA_WEBHOOK_IPS"))).toBe(true);
  });

  it("does NOT warn about IP allowlists for providers that are disabled (trigger var unset)", () => {
    // Production with NO providers configured — should not warn
    // about ANY of the IP allowlist vars. Otherwise operators see
    // 3 noise warnings on every boot of a new env until they wire
    // a provider, training them to ignore real warnings.
    const result = checkProviderSecrets({
      env: { PAYMENT_WEBHOOK_SECRET: "s" },
      nodeEnv: "production",
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("WAVE_WEBHOOK_IPS"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("OM_WEBHOOK_IPS"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("PAYDUNYA_WEBHOOK_IPS"))).toBe(false);
  });

  it("warns selectively per enabled provider", () => {
    // Wave enabled, OM disabled, PayDunya enabled → 2 warnings
    // (Wave + PayDunya), no OM warning.
    const result = checkProviderSecrets({
      env: {
        PAYMENT_WEBHOOK_SECRET: "s",
        WAVE_API_KEY: "wk",
        WAVE_API_SECRET: "ws",
        PAYDUNYA_MASTER_KEY: "pmk",
        PAYDUNYA_PRIVATE_KEY: "ppk",
        PAYDUNYA_TOKEN: "pt",
      },
      nodeEnv: "production",
    });
    expect(result.warnings.some((w) => w.includes("WAVE_WEBHOOK_IPS"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("OM_WEBHOOK_IPS"))).toBe(false);
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
    // Phase-2 update — warnings only fire for ENABLED providers
    // (their trigger var is set). Configure Wave so the IP-allowlist
    // warning fires; everything else is fine for production.
    expect(() =>
      assertProviderSecrets({
        env: {
          PAYMENT_WEBHOOK_SECRET: "s",
          WAVE_API_KEY: "wk",
          WAVE_API_SECRET: "ws",
        },
        nodeEnv: "production",
      }),
    ).not.toThrow();
    const stderrOutput = (stderrSpy?.mock.calls ?? []).flat().join("");
    expect(stderrOutput).toContain("WAVE_WEBHOOK_IPS");
    expect(stderrOutput).toContain("provider_secret_warning");
  });
});
