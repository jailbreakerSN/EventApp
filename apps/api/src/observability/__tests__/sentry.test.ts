/**
 * Pins the W10-P1 cross-tenant safety contract for `setSentryUser`.
 *
 * Background
 * ──────────
 * Cloud Run handles many concurrent HTTP requests in a single Node
 * process. The first cut of `setSentryUser` called `Sentry.setUser()`
 * + `Sentry.setTag()` directly, which write to the GLOBAL scope.
 * Under concurrency that's a cross-tenant data leak: Request A's
 * `organizationId` tag could end up on Request B's exception report.
 *
 * The fix routes the writes through `Sentry.getIsolationScope()`,
 * which Sentry's httpIntegration scopes per-async-context (per HTTP
 * request). This test pins both halves of the contract:
 *
 *   1. `setSentryUser` writes the uid + organizationId on the
 *      isolation scope, NOT the global scope.
 *   2. The function is a no-op when Sentry isn't initialised (DSN
 *      unset).
 *
 * The `withSpan` no-op branch is also pinned — it must call the
 * callback exactly once and propagate its return value when Sentry
 * isn't initialised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const setUser = vi.fn();
const setTag = vi.fn();
const isolationScope = { setUser, setTag };

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  close: vi.fn(),
  getIsolationScope: vi.fn(() => isolationScope),
  startSpan: vi.fn((_options: unknown, cb: () => unknown) => cb()),
}));

vi.mock("@/config/index", () => ({
  config: { SENTRY_DSN: undefined, NODE_ENV: "test" },
}));

import * as SentryModule from "@/observability/sentry";

describe("setSentryUser — cross-tenant isolation contract (W10-P1)", () => {
  beforeEach(() => {
    setUser.mockReset();
    setTag.mockReset();
  });

  it("is a no-op when Sentry is not initialised", () => {
    // initSentry was never called (DSN is undefined in the mock config),
    // so isSentryEnabled() is false and setSentryUser must short-circuit.
    expect(SentryModule.isSentryEnabled()).toBe(false);

    SentryModule.setSentryUser({ uid: "user_A", organizationId: "org_A" });

    expect(setUser).not.toHaveBeenCalled();
    expect(setTag).not.toHaveBeenCalled();
  });

  it("writes user + organizationId on the per-request isolation scope when initialised", async () => {
    // Force the module to think it's initialised by replaying the
    // initSentry path with a DSN. The dynamic re-import loads the
    // module against a fresh mock state with DSN set.
    vi.resetModules();
    vi.doMock("@/config/index", () => ({
      config: { SENTRY_DSN: "https://example.invalid/1", NODE_ENV: "test" },
    }));
    const fresh = await import("@/observability/sentry");
    fresh.initSentry();

    fresh.setSentryUser({ uid: "user_B", organizationId: "org_B" });

    expect(setUser).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith({ id: "user_B" });
    expect(setTag).toHaveBeenCalledWith("organizationId", "org_B");
    // Critical security property — the writes go to the isolation
    // scope, not the global scope. Asserting it explicitly so the
    // contract fails if a future refactor reaches for `Sentry.setUser`
    // / `Sentry.setTag` directly again.
    const sentry = await import("@sentry/node");
    expect(sentry.getIsolationScope).toHaveBeenCalled();
    vi.doUnmock("@/config/index");
  });

  it("omits the organizationId tag when none is provided", async () => {
    vi.resetModules();
    vi.doMock("@/config/index", () => ({
      config: { SENTRY_DSN: "https://example.invalid/1", NODE_ENV: "test" },
    }));
    const fresh = await import("@/observability/sentry");
    fresh.initSentry();

    fresh.setSentryUser({ uid: "user_C", organizationId: null });

    expect(setUser).toHaveBeenCalledWith({ id: "user_C" });
    expect(setTag).not.toHaveBeenCalled();
    vi.doUnmock("@/config/index");
  });
});

describe("withSpan — pass-through contract (W10-P1)", () => {
  beforeEach(() => {
    setUser.mockReset();
    setTag.mockReset();
  });

  it("calls the callback exactly once and returns its value when Sentry is not initialised", async () => {
    vi.resetModules();
    vi.doMock("@/config/index", () => ({
      config: { SENTRY_DSN: undefined, NODE_ENV: "test" },
    }));
    const fresh = await import("@/observability/sentry");
    expect(fresh.isSentryEnabled()).toBe(false);

    const cb = vi.fn(async () => "value");
    const result = await fresh.withSpan({ op: "db.firestore", name: "test" }, cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(result).toBe("value");
    vi.doUnmock("@/config/index");
  });

  it("propagates errors thrown by the callback", async () => {
    vi.resetModules();
    vi.doMock("@/config/index", () => ({
      config: { SENTRY_DSN: undefined, NODE_ENV: "test" },
    }));
    const fresh = await import("@/observability/sentry");

    const boom = new Error("boom");
    await expect(
      fresh.withSpan({ op: "db.firestore", name: "test" }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    vi.doUnmock("@/config/index");
  });

  it("delegates to Sentry.startSpan when initialised", async () => {
    vi.resetModules();
    vi.doMock("@/config/index", () => ({
      config: { SENTRY_DSN: "https://example.invalid/1", NODE_ENV: "test" },
    }));
    const fresh = await import("@/observability/sentry");
    fresh.initSentry();

    await fresh.withSpan({ op: "db.firestore", name: "events.findById" }, async () => "done");

    const sentry = await import("@sentry/node");
    expect(sentry.startSpan).toHaveBeenCalled();
    vi.doUnmock("@/config/index");
  });
});
