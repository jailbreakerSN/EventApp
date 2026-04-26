import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Balance release trigger tests ─────────────────────────────────────────
//
// The trigger is now a thin scheduler wrapper that POSTs to
// `/v1/internal/balance/release-available` (the actual sweep + audit
// logic lives in the API handler at
// apps/api/src/jobs/handlers/release-available-funds.ts).
//
// What we pin here:
//   1. Env guard short-circuits in non-prod environments.
//   2. Missing API_BASE_URL or INTERNAL_DISPATCH_SECRET → warn + return,
//      no fetch attempt.
//   3. Happy path: fetch posts to the right URL with the right headers
//      and an empty body (defaults applied server-side).
//   4. Non-2xx response → error log, no throw (the next cron tick retries).
//   5. AbortError on timeout → error log with the timeout-specific copy.

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { releaseAvailableFunds } from "../balance.triggers";
import { logger } from "firebase-functions/v2";

const handler = releaseAvailableFunds as unknown as () => Promise<void>;

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  // Default to production for every test that doesn't explicitly set a
  // different env — keeps the happy-path suite from accidentally being
  // short-circuited by the env guard.
  process.env.GCLOUD_PROJECT = "teranga-events-prod";
  process.env.API_BASE_URL = "https://api.teranga.test";
  process.env.INTERNAL_DISPATCH_SECRET = "x".repeat(32);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("releaseAvailableFunds", () => {
  // ─── Env guard ───────────────────────────────────────────────────────────

  it("short-circuits with an INFO log in staging — no fetch attempt", async () => {
    process.env.GCLOUD_PROJECT = "teranga-app-990a8";

    await handler();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "balance.release: skipped (non-production env)",
      expect.objectContaining({ env: "staging" }),
    );
  });

  it("short-circuits in development (unknown project id) — no fetch attempt", async () => {
    delete process.env.GCLOUD_PROJECT;

    await handler();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "balance.release: skipped (non-production env)",
      expect.objectContaining({ env: "development" }),
    );
  });

  // ─── Configuration sanity ────────────────────────────────────────────────

  it("warns and returns when API_BASE_URL is missing", async () => {
    delete process.env.API_BASE_URL;

    await handler();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "balance.release: missing API_BASE_URL or INTERNAL_DISPATCH_SECRET",
      expect.objectContaining({ hasUrl: false, hasSecret: true }),
    );
  });

  it("warns and returns when INTERNAL_DISPATCH_SECRET is missing", async () => {
    delete process.env.INTERNAL_DISPATCH_SECRET;

    await handler();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "balance.release: missing API_BASE_URL or INTERNAL_DISPATCH_SECRET",
      expect.objectContaining({ hasUrl: true, hasSecret: false }),
    );
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it("POSTs to /v1/internal/balance/release-available with the secret header and empty body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ success: true, data: { released: 12, organizationsAudited: 3 } }),
    });

    await handler();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.teranga.test/v1/internal/balance/release-available");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Internal-Dispatch-Secret"]).toBe("x".repeat(32));
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe("{}");

    expect(logger.info).toHaveBeenCalledWith(
      "balance.release: sweep complete",
      expect.objectContaining({ released: 12, organizationsAudited: 3 }),
    );
  });

  // ─── Failure modes ───────────────────────────────────────────────────────

  it("logs an error and returns without throwing on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "upstream temporarily unavailable",
    });

    await expect(handler()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "balance.release: API returned non-2xx",
      expect.objectContaining({ status: 503 }),
    );
  });

  it("logs the timeout-specific copy on AbortError", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortErr);

    await expect(handler()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "balance.release: API call timed out (480s)",
      expect.objectContaining({ event: "balance.release.timeout" }),
    );
  });

  it("logs a generic error on any other fetch failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("DNS lookup failed"));

    await expect(handler()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "balance.release: API call failed",
      expect.objectContaining({ err: "DNS lookup failed" }),
    );
  });
});
