import { describe, it, expect, vi, afterEach } from "vitest";

// ─── SPEC: QR_MASTER production hard-fail (post-audit) ─────────────────────
// v4 signing derives per-event HKDF keys from `config.QR_MASTER`. In dev
// the module falls back to `config.QR_SECRET` (the v3 global key) with a
// stderr warning — convenient for local runs but dangerous in prod
// because stealing QR_SECRET (the v3 key) then gives you v4 forgery via
// the shared master. The module MUST hard-fail with a clear error when
// `NODE_ENV === "production"` and `QR_MASTER` is unset.
//
// This file is a separate module from the main qr-signing suite so we
// can `vi.doMock("@/config/index", ...)` to return a production config
// WITHOUT QR_MASTER, then dynamically import `qr-signing` so the module
// loads the mocked config. Regular `vi.mock` at the top would also work,
// but dynamic import per-test lets us flip the env + remount cleanly.
//
// Regression this catches: a refactor that drops the `NODE_ENV ===
// "production"` check. Without this test, such a regression would pass
// unit tests (dev runs still fall back) and only manifest on the first
// production deploy — where every new v4 badge would share the v3 secret
// key namespace, collapsing the per-event isolation property.

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("QR_MASTER production hard-fail", () => {
  it("throws when QR_MASTER is unset in production", async () => {
    process.env.NODE_ENV = "production";

    // Mock the config module to simulate a prod deploy that forgot to
    // set QR_MASTER. QR_SECRET stays set (v3 keeps working) so we
    // isolate the v4 failure path.
    vi.doMock("@/config/index", () => ({
      config: {
        NODE_ENV: "production",
        QR_MASTER: undefined,
        QR_SECRET: "legacy-v3-secret-at-least-16-chars",
      },
    }));

    const qrSigning = await import("../qr-signing");
    const kid = qrSigning.generateEventKid();

    expect(() =>
      qrSigning.signQrPayloadV4(
        "reg-1",
        "evt-1",
        "user-1",
        Date.now() - 86_400_000,
        Date.now() + 365 * 86_400_000,
        kid,
      ),
    ).toThrow(/QR_MASTER is required in production/);
  });

  it("falls back to QR_SECRET (with warning) when NODE_ENV is not production", async () => {
    // The dev-time fallback is intentional so local development doesn't
    // require a second secret. This test pins that behaviour explicitly
    // so a refactor that accidentally makes the module hard-fail in
    // every env (and breaks local dev) is also caught.
    process.env.NODE_ENV = "development";

    vi.doMock("@/config/index", () => ({
      config: {
        NODE_ENV: "development",
        QR_MASTER: undefined,
        QR_SECRET: "legacy-v3-secret-at-least-16-chars",
      },
    }));

    const qrSigning = await import("../qr-signing");
    const kid = qrSigning.generateEventKid();

    // Does NOT throw — produces a v4 payload signed with the fallback key.
    const payload = qrSigning.signQrPayloadV4(
      "reg-1",
      "evt-1",
      "user-1",
      Date.now() - 86_400_000,
      Date.now() + 365 * 86_400_000,
      kid,
    );
    expect(payload.split(":").length).toBe(7);
  });

  it("uses QR_MASTER (not QR_SECRET) when both are set (isolation property)", async () => {
    // Critical invariant: when QR_MASTER IS set, v4 signing must derive
    // from it — NOT from QR_SECRET. Otherwise the "collapse of v3/v4
    // key isolation" protection is bypassed silently. Verify by
    // comparing a v4 signature produced under (QR_MASTER=A) against the
    // same payload under (QR_MASTER=B, same QR_SECRET): the signatures
    // MUST differ. If the module ignored QR_MASTER and always used
    // QR_SECRET, both runs would produce identical HMACs.
    process.env.NODE_ENV = "development";

    vi.doMock("@/config/index", () => ({
      config: {
        NODE_ENV: "development",
        QR_MASTER: "master-key-A-at-least-32-chars-long-aaaa",
        QR_SECRET: "legacy-v3-secret-at-least-16-chars",
      },
    }));
    const qrSigningA = await import("../qr-signing");
    const kid = qrSigningA.generateEventKid();
    const sigA = qrSigningA.signQrPayloadV4(
      "reg-1",
      "evt-1",
      "user-1",
      Date.now() - 86_400_000,
      Date.now() + 365 * 86_400_000,
      kid,
    );

    vi.resetModules();
    vi.doMock("@/config/index", () => ({
      config: {
        NODE_ENV: "development",
        QR_MASTER: "master-key-B-at-least-32-chars-long-bbbb",
        QR_SECRET: "legacy-v3-secret-at-least-16-chars", // same as run A
      },
    }));
    const qrSigningB = await import("../qr-signing");
    const sigB = qrSigningB.signQrPayloadV4(
      "reg-1",
      "evt-1",
      "user-1",
      Date.now() - 86_400_000,
      Date.now() + 365 * 86_400_000,
      kid,
    );

    // Different masters ⇒ different HMACs. If these were equal, the
    // module would be ignoring QR_MASTER entirely.
    expect(sigA).not.toBe(sigB);
  });
});
