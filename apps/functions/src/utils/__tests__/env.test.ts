import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTerangaEnv, isProduction, productionOnly } from "../env";

// ─── env helper coverage ──────────────────────────────────────────────────
//
// Pin both the project-id detection AND the productionOnly wrapper. The
// first regression we'd ship without these is "cron in staging eats
// provider verify quota" — high-impact, silent, hard to spot in logs.

describe("getTerangaEnv", () => {
  const original = process.env.GCLOUD_PROJECT;

  beforeEach(() => {
    delete process.env.GCLOUD_PROJECT;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GCLOUD_PROJECT;
    } else {
      process.env.GCLOUD_PROJECT = original;
    }
  });

  it('detects production when GCLOUD_PROJECT === "teranga-events-prod"', () => {
    process.env.GCLOUD_PROJECT = "teranga-events-prod";
    expect(getTerangaEnv()).toBe("production");
    expect(isProduction()).toBe(true);
  });

  it('detects staging when GCLOUD_PROJECT === "teranga-app-990a8"', () => {
    process.env.GCLOUD_PROJECT = "teranga-app-990a8";
    expect(getTerangaEnv()).toBe("staging");
    expect(isProduction()).toBe(false);
  });

  it("falls back to development for any other project id", () => {
    process.env.GCLOUD_PROJECT = "teranga-some-other-project";
    expect(getTerangaEnv()).toBe("development");
    expect(isProduction()).toBe(false);
  });

  it("falls back to development when GCLOUD_PROJECT is unset", () => {
    expect(getTerangaEnv()).toBe("development");
    expect(isProduction()).toBe(false);
  });
});

describe("productionOnly wrapper", () => {
  const original = process.env.GCLOUD_PROJECT;

  function makeLogger() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  }

  beforeEach(() => {
    delete process.env.GCLOUD_PROJECT;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GCLOUD_PROJECT;
    } else {
      process.env.GCLOUD_PROJECT = original;
    }
  });

  it("invokes the inner function in production", async () => {
    process.env.GCLOUD_PROJECT = "teranga-events-prod";
    const inner = vi.fn(async () => undefined);
    const logger = makeLogger();

    const wrapped = productionOnly("balance.release", logger as never, inner);
    await wrapped();

    expect(inner).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("skipped"),
      expect.anything(),
    );
  });

  it("short-circuits with INFO log in staging — inner function never runs", async () => {
    process.env.GCLOUD_PROJECT = "teranga-app-990a8";
    const inner = vi.fn();
    const logger = makeLogger();

    const wrapped = productionOnly("balance.release", logger as never, inner);
    await wrapped();

    expect(inner).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "balance.release: skipped (non-production env)",
      expect.objectContaining({ event: "balance.release.skipped", env: "staging" }),
    );
  });

  it("short-circuits in development (unset GCLOUD_PROJECT)", async () => {
    const inner = vi.fn();
    const logger = makeLogger();

    const wrapped = productionOnly("payment.reconciliation", logger as never, inner);
    await wrapped();

    expect(inner).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "payment.reconciliation: skipped (non-production env)",
      expect.objectContaining({ env: "development" }),
    );
  });

  it("forwards arguments to the inner function in production", async () => {
    process.env.GCLOUD_PROJECT = "teranga-events-prod";
    const inner = vi.fn(async (_event: { foo: string }) => undefined);
    const logger = makeLogger();

    const wrapped = productionOnly("test.job", logger as never, inner);
    await wrapped({ foo: "bar" });

    expect(inner).toHaveBeenCalledWith({ foo: "bar" });
  });

  it("propagates errors thrown by the inner function in production", async () => {
    process.env.GCLOUD_PROJECT = "teranga-events-prod";
    const inner = vi.fn(async () => {
      throw new Error("boom");
    });
    const logger = makeLogger();

    const wrapped = productionOnly("test.job", logger as never, inner);
    await expect(wrapped()).rejects.toThrow("boom");
  });
});
