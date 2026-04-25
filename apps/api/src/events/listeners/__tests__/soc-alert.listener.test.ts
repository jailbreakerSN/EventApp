import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Sprint-3 T4.1 + Senior-review F-3 — SOC alert listener tests.
 *
 * Coverage:
 *   - The 7 critical actions each post a payload with the right shape.
 *   - The HMAC-SHA256 signature header is stamped when the secret is set.
 *   - Unsigned posts go out (with a stderr warning) when the secret is unset.
 *   - When the webhook URL is unset, no listeners are registered + no
 *     fetch goes out.
 *   - Webhook failures (non-2xx, network error) are caught and logged
 *     to stderr — never propagated to the originating request.
 *
 * Mock isolation:
 *   - The event bus is a fresh instance per test (re-`registerSocAlertListeners`
 *     wires fresh handlers against the mocked `fetch`).
 *   - `fetch` is stubbed via `globalThis.fetch = vi.fn(...)`.
 *   - The config module is mocked so URL + secret can be flipped per test.
 */

const hoisted = vi.hoisted(() => ({
  config: {
    SOC_ALERT_WEBHOOK_URL: "https://soc.example.com/hook" as string | undefined,
    SOC_ALERT_WEBHOOK_SECRET: "test-soc-secret-32-chars-minimum-aaaa" as string | undefined,
  },
}));

vi.mock("@/config", () => ({
  get config() {
    return hoisted.config;
  },
}));

import { eventBus } from "@/events/event-bus";
import { registerSocAlertListeners } from "../soc-alert.listener";

const fetchMock = vi.fn();
const stderrMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to "happy path" defaults each test.
  hoisted.config.SOC_ALERT_WEBHOOK_URL = "https://soc.example.com/hook";
  hoisted.config.SOC_ALERT_WEBHOOK_SECRET = "test-soc-secret-32-chars-minimum-aaaa";
  // Wipe any handlers registered by previous tests so each test runs
  // against a clean slate. The bus is a singleton so we have to be
  // careful here.
  eventBus.removeAllListeners();
  // Default fetch mock: 200 OK.
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Capture stderr writes silently.
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrMock(String(chunk));
    return true;
  });
});

afterEach(() => {
  eventBus.removeAllListeners();
  vi.restoreAllMocks();
});

// ─── Wiring ────────────────────────────────────────────────────────────────

describe("registerSocAlertListeners — wiring", () => {
  it("registers no listeners when SOC_ALERT_WEBHOOK_URL is unset (emit is a no-op)", async () => {
    hoisted.config.SOC_ALERT_WEBHOOK_URL = undefined;
    registerSocAlertListeners();

    eventBus.emit("user.role_changed", {
      actorId: "admin-1",
      targetUserId: "user-1",
      oldRoles: [],
      newRoles: ["organizer"],
      requestId: "req-0",
      timestamp: "2026-04-25T10:00:00.000Z",
    });
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wires listeners for each of the 7 critical actions when the URL is set", async () => {
    registerSocAlertListeners();

    const actions: Array<[string, () => void]> = [
      [
        "user.role_changed",
        () =>
          eventBus.emit("user.role_changed", {
            actorId: "a",
            targetUserId: "t",
            oldRoles: [],
            newRoles: ["organizer"],
            requestId: "r",
            timestamp: "2026-04-25T10:00:00.000Z",
          }),
      ],
      [
        "user.impersonated",
        () =>
          eventBus.emit("user.impersonated", {
            actorUid: "a",
            targetUid: "t",
            expiresAt: "2026-04-25T10:01:00.000Z",
          } as never),
      ],
      [
        "user.impersonation_ended",
        () =>
          eventBus.emit("user.impersonation_ended", {
            actorUid: "a",
            targetUid: "t",
          } as never),
      ],
      [
        "subscription.cancelled",
        () =>
          eventBus.emit("subscription.cancelled", {
            actorId: "a",
            organizationId: "o",
            planKey: "pro",
            cancelledBy: "self",
            effectiveAt: "2026-05-01T00:00:00.000Z",
            requestId: "r",
            timestamp: "2026-04-25T10:00:00.000Z",
          } as never),
      ],
      [
        "api_key.created",
        () =>
          eventBus.emit("api_key.created", {
            actorId: "a",
            apiKeyId: "k",
            organizationId: "o",
            scopes: ["event:read"],
            environment: "live",
            name: "n",
            requestId: "r",
            timestamp: "2026-04-25T10:00:00.000Z",
          }),
      ],
      [
        "api_key.rotated",
        () =>
          eventBus.emit("api_key.rotated", {
            actorId: "a",
            previousApiKeyId: "old",
            newApiKeyId: "new",
            organizationId: "o",
            requestId: "r",
            timestamp: "2026-04-25T10:00:00.000Z",
          } as never),
      ],
      [
        "api_key.revoked",
        () =>
          eventBus.emit("api_key.revoked", {
            actorId: "a",
            apiKeyId: "k",
            organizationId: "o",
            reason: "compromis",
            requestId: "r",
            timestamp: "2026-04-25T10:00:00.000Z",
          } as never),
      ],
    ];

    for (const [, emitter] of actions) {
      emitter();
    }
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(actions.length);
  });
});

// ─── HMAC signing (Senior-review F-3) ──────────────────────────────────────

describe("registerSocAlertListeners — HMAC signing", () => {
  it("stamps X-Teranga-Signature: sha256=<hex> when the secret is set", async () => {
    registerSocAlertListeners();

    eventBus.emit("user.role_changed", {
      actorId: "admin-1",
      targetUserId: "user-1",
      oldRoles: ["participant"],
      newRoles: ["organizer"],
      requestId: "req-1",
      timestamp: "2026-04-25T10:00:00.000Z",
    });
    // Listeners are async — flush microtasks.
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Teranga-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("posts unsigned (no signature header) + stderr-warns when the secret is unset", async () => {
    hoisted.config.SOC_ALERT_WEBHOOK_SECRET = undefined;
    registerSocAlertListeners();

    eventBus.emit("user.role_changed", {
      actorId: "admin-1",
      targetUserId: "user-1",
      oldRoles: [],
      newRoles: ["organizer"],
      requestId: "req-2",
      timestamp: "2026-04-25T10:00:00.000Z",
    });
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Teranga-Signature"]).toBeUndefined();
    expect(stderrMock).toHaveBeenCalledWith(
      expect.stringContaining("SOC_ALERT_WEBHOOK_SECRET unset"),
    );
  });
});

// ─── Per-action payload shape ──────────────────────────────────────────────

describe("registerSocAlertListeners — payload shapes", () => {
  it("api_key.created carries the org + scopes in the summary", async () => {
    registerSocAlertListeners();

    eventBus.emit("api_key.created", {
      actorId: "admin-1",
      apiKeyId: "abc1234567",
      organizationId: "org-42",
      scopes: ["checkin:scan", "event:read"],
      environment: "live",
      name: "Scanner #1",
      requestId: "req-3",
      timestamp: "2026-04-25T10:00:00.000Z",
    });
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.action).toBe("api_key.created");
    expect(body.severity).toBe("warning");
    expect(body.organizationId).toBe("org-42");
    expect(body.summary).toContain("Scanner #1");
    expect(body.summary).toContain("env=live");
    expect(body.summary).toContain("checkin:scan,event:read");
  });

  it("subscription.cancelled marks severity=warning and surfaces the plan + actor", async () => {
    registerSocAlertListeners();

    eventBus.emit("subscription.cancelled", {
      actorId: "admin-1",
      organizationId: "org-9",
      planKey: "pro",
      cancelledBy: "self",
      effectiveAt: "2026-05-01T00:00:00.000Z",
      requestId: "req-4",
      timestamp: "2026-04-25T10:00:00.000Z",
    });
    await new Promise((r) => setImmediate(r));

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.action).toBe("subscription.cancelled");
    expect(body.severity).toBe("warning");
    expect(body.summary).toContain("pro cancelled");
    expect(body.summary).toContain("org-9");
  });

  it("user.role_changed marks severity=critical and includes the role diff", async () => {
    registerSocAlertListeners();

    eventBus.emit("user.role_changed", {
      actorId: "admin-1",
      targetUserId: "user-1",
      oldRoles: ["participant"],
      newRoles: ["organizer", "speaker"],
      requestId: "req-5",
      timestamp: "2026-04-25T10:00:00.000Z",
    });
    await new Promise((r) => setImmediate(r));

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.severity).toBe("critical");
    expect(body.summary).toContain("participant");
    expect(body.summary).toContain("organizer|speaker");
  });
});

// ─── Failure modes — best-effort posting ───────────────────────────────────

describe("registerSocAlertListeners — failure handling", () => {
  it("logs to stderr but does NOT throw when the webhook returns 5xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    registerSocAlertListeners();

    eventBus.emit("api_key.revoked", {
      actorId: "admin-1",
      apiKeyId: "abc1234567",
      organizationId: "org-1",
      reason: "Compromis",
      requestId: "req-6",
      timestamp: "2026-04-25T10:00:00.000Z",
    });
    await new Promise((r) => setImmediate(r));

    expect(stderrMock).toHaveBeenCalledWith(
      expect.stringContaining("returned 503"),
    );
  });

  it("logs to stderr but does NOT throw on a network error", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    registerSocAlertListeners();

    eventBus.emit("api_key.rotated", {
      actorId: "admin-1",
      previousApiKeyId: "old1234567",
      newApiKeyId: "new1234567",
      organizationId: "org-1",
      requestId: "req-7",
      timestamp: "2026-04-25T10:00:00.000Z",
    });
    await new Promise((r) => setImmediate(r));

    expect(stderrMock).toHaveBeenCalledWith(
      expect.stringContaining("ECONNREFUSED"),
    );
  });
});
