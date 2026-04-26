import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isIpAllowed, webhookIpAllowlist } from "../webhook-ip-allowlist.middleware";

// P1-15 (audit H6) — webhook IP allowlist contract.

describe("isIpAllowed (pure matcher)", () => {
  it("fails OPEN when allowlist is empty", () => {
    expect(isIpAllowed("1.2.3.4", undefined)).toBe(true);
    expect(isIpAllowed("1.2.3.4", "")).toBe(true);
    expect(isIpAllowed("1.2.3.4", "   ")).toBe(true);
  });

  // ── IPv4 exact ────────────────────────────────────────────────────────────
  it("matches an exact IPv4 entry", () => {
    expect(isIpAllowed("1.2.3.4", "1.2.3.4")).toBe(true);
    expect(isIpAllowed("1.2.3.5", "1.2.3.4")).toBe(false);
  });

  it("supports a comma-separated list", () => {
    const list = "1.2.3.4, 5.6.7.8 ,9.10.11.12";
    expect(isIpAllowed("5.6.7.8", list)).toBe(true);
    expect(isIpAllowed("9.10.11.12", list)).toBe(true);
    expect(isIpAllowed("1.2.3.5", list)).toBe(false);
  });

  // ── IPv4 CIDR ─────────────────────────────────────────────────────────────
  it("matches an IPv4 inside a /24 CIDR", () => {
    expect(isIpAllowed("192.168.1.42", "192.168.1.0/24")).toBe(true);
    expect(isIpAllowed("192.168.1.255", "192.168.1.0/24")).toBe(true);
    expect(isIpAllowed("192.168.2.1", "192.168.1.0/24")).toBe(false);
  });

  it("matches an IPv4 inside a /16 CIDR", () => {
    expect(isIpAllowed("10.0.42.99", "10.0.0.0/16")).toBe(true);
    expect(isIpAllowed("10.1.0.0", "10.0.0.0/16")).toBe(false);
  });

  it("handles /32 CIDR (single host)", () => {
    expect(isIpAllowed("8.8.8.8", "8.8.8.8/32")).toBe(true);
    expect(isIpAllowed("8.8.8.9", "8.8.8.8/32")).toBe(false);
  });

  it("handles /0 CIDR (everything)", () => {
    expect(isIpAllowed("99.99.99.99", "0.0.0.0/0")).toBe(true);
  });

  // ── IPv6 ──────────────────────────────────────────────────────────────────
  it("matches an exact IPv6 entry", () => {
    expect(isIpAllowed("2001:db8::1", "2001:db8::1")).toBe(true);
    expect(isIpAllowed("2001:db8::2", "2001:db8::1")).toBe(false);
  });

  it("matches an IPv6 inside a /64 CIDR", () => {
    expect(isIpAllowed("2001:db8::dead:beef", "2001:db8::/32")).toBe(true);
    expect(isIpAllowed("2001:dc8::1", "2001:db8::/32")).toBe(false);
  });

  // ── Defensive ─────────────────────────────────────────────────────────────
  it("rejects malformed IPs without throwing", () => {
    expect(isIpAllowed("not-an-ip", "1.2.3.4")).toBe(false);
    expect(isIpAllowed("", "1.2.3.4")).toBe(false);
    expect(isIpAllowed(null, "1.2.3.4")).toBe(false);
    expect(isIpAllowed(undefined, "1.2.3.4")).toBe(false);
  });

  it("ignores malformed allowlist entries (logs but doesn't throw)", () => {
    const list = "garbage, 1.2.3.4, also/garbage/here, 5.6.7.8";
    expect(isIpAllowed("1.2.3.4", list)).toBe(true);
    expect(isIpAllowed("5.6.7.8", list)).toBe(true);
    expect(isIpAllowed("9.9.9.9", list)).toBe(false);
  });

  it("rejects IPv4 against an IPv6 entry (no cross-family false positive)", () => {
    expect(isIpAllowed("1.2.3.4", "2001:db8::/32")).toBe(false);
    expect(isIpAllowed("2001:db8::1", "1.2.3.0/24")).toBe(false);
  });
});

// ── Fastify preHandler integration ──────────────────────────────────────────

interface FakeReply {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeReply;
  send: (body: unknown) => FakeReply;
}

function buildFakeReply(): FakeReply {
  const reply: FakeReply = {
    statusCode: 200,
    body: undefined,
    status: (code: number) => {
      reply.statusCode = code;
      return reply;
    },
    send: (body: unknown) => {
      reply.body = body;
      return reply;
    },
  };
  return reply;
}

describe("webhookIpAllowlist preHandler", () => {
  const ORIGINAL_ENV = process.env;
  // Inferred type — explicit annotation conflicts with the spyOn
  // overloads on `process.stderr.write` (string | Uint8Array variants).
  let stderrSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.WAVE_WEBHOOK_IPS;
    delete process.env.OM_WEBHOOK_IPS;
    delete process.env.PAYDUNYA_WEBHOOK_IPS;
    delete process.env.MOCK_WEBHOOK_IPS;
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    stderrSpy?.mockRestore();
  });

  it("fail-OPENs when env var is unset (dev posture)", async () => {
    const reply = buildFakeReply();
    const request = { params: { provider: "wave" }, ip: "8.8.8.8", id: "req-1" } as unknown as Parameters<
      typeof webhookIpAllowlist
    >[0];
    await webhookIpAllowlist(request, reply as unknown as Parameters<typeof webhookIpAllowlist>[1]);
    expect(reply.statusCode).toBe(200); // never touched — fall-through to next handler
  });

  it("allows a request from an allowlisted IP", async () => {
    process.env.WAVE_WEBHOOK_IPS = "203.0.113.10/32, 198.51.100.0/24";
    const reply = buildFakeReply();
    const request = {
      params: { provider: "wave" },
      ip: "198.51.100.42",
      id: "req-2",
    } as unknown as Parameters<typeof webhookIpAllowlist>[0];
    await webhookIpAllowlist(request, reply as unknown as Parameters<typeof webhookIpAllowlist>[1]);
    expect(reply.statusCode).toBe(200);
  });

  it("rejects a request from a non-allowlisted IP with 403 (BEFORE HMAC compute)", async () => {
    process.env.WAVE_WEBHOOK_IPS = "203.0.113.0/24";
    const reply = buildFakeReply();
    const request = {
      params: { provider: "wave" },
      ip: "8.8.8.8",
      id: "req-3",
    } as unknown as Parameters<typeof webhookIpAllowlist>[0];
    await webhookIpAllowlist(request, reply as unknown as Parameters<typeof webhookIpAllowlist>[1]);
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toMatchObject({
      success: false,
      error: { code: "FORBIDDEN" },
    });
    // Structured stderr log so SRE can investigate.
    const stderrOutput = (stderrSpy?.mock.calls ?? []).flat().join("");
    expect(stderrOutput).toContain("webhook_ip_allowlist_rejected");
    expect(stderrOutput).toContain('"provider":"wave"');
    expect(stderrOutput).toContain('"ip":"8.8.8.8"');
  });

  it("uses the right env var per provider (orange_money → OM_WEBHOOK_IPS)", async () => {
    process.env.OM_WEBHOOK_IPS = "10.0.0.0/8";
    process.env.WAVE_WEBHOOK_IPS = "192.0.2.0/24"; // different subnet
    const reply = buildFakeReply();
    const request = {
      params: { provider: "orange_money" },
      ip: "10.20.30.40",
      id: "req-4",
    } as unknown as Parameters<typeof webhookIpAllowlist>[0];
    await webhookIpAllowlist(request, reply as unknown as Parameters<typeof webhookIpAllowlist>[1]);
    expect(reply.statusCode).toBe(200); // matches OM allowlist
  });

  it("rejects when the provider has no env-var mapping AND a parameter is missing", async () => {
    // Defensive: if `provider` is missing (e.g. legacy /webhook route), the
    // middleware is a no-op. The legacy route is mock-only in non-prod and
    // 404s in production via the route handler itself.
    const reply = buildFakeReply();
    const request = { params: {}, ip: "8.8.8.8", id: "req-5" } as unknown as Parameters<
      typeof webhookIpAllowlist
    >[0];
    await webhookIpAllowlist(request, reply as unknown as Parameters<typeof webhookIpAllowlist>[1]);
    expect(reply.statusCode).toBe(200);
  });

  it("fail-CLOSEs when env var is set but parses to nothing (operator garbage)", async () => {
    process.env.WAVE_WEBHOOK_IPS = "completely-bogus, also-bad/9999";
    const reply = buildFakeReply();
    const request = {
      params: { provider: "wave" },
      ip: "203.0.113.10",
      id: "req-6",
    } as unknown as Parameters<typeof webhookIpAllowlist>[0];
    await webhookIpAllowlist(request, reply as unknown as Parameters<typeof webhookIpAllowlist>[1]);
    // A configured-but-empty allowlist is treated as fail-CLOSED — we'd
    // rather alarm the operator than silently allow everything.
    expect(reply.statusCode).toBe(403);
  });
});
