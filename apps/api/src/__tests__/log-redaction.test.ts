/**
 * Pins Wave 10 / W10-P1 — Pino redact contract.
 *
 * Background
 * ──────────
 * Before W10-P1 the API logger had no `redact` configuration. Every
 * `request.log.info({ ... })` call dumped its argument verbatim into
 * Cloud Logging — including `Authorization` headers (Firebase ID
 * tokens, org API keys), PayDunya IPN bodies (`req.body.data` carries
 * payment metadata + customer email), webhook signatures, and any
 * structured log object that included an `email` / `phoneNumber`
 * field.
 *
 * The fix added a `redact: { paths, censor: "[REDACTED]" }` block to
 * the Fastify logger options in `apps/api/src/app.ts` covering:
 *   - Authorization / Cookie request headers
 *   - Set-Cookie response headers
 *   - Webhook body fields (`data`, `password`, `token`, `signature`)
 *   - PII keys (email, phoneNumber, phone) at top-level and one-level
 *     nested
 *   - Auth tokens (idToken, refreshToken, accessToken, apiKey, ...)
 *   - Payment surface (paymentToken, cardNumber, cvv, pan)
 *
 * This test pins the contract: a logger created with the same redact
 * paths as production must censor every protected key, regardless of
 * the surrounding object shape. The test imports the redact paths
 * directly from `app.ts` so any drift between the production list and
 * this test fails the assertion in lockstep.
 *
 * What this test does NOT cover
 * ─────────────────────────────
 * - Per-route logger overrides (none today; if added later they MUST
 *   inherit the global `redact` block — flag the drift in PR review).
 * - The Pino-pretty transport in dev: redact is applied BEFORE the
 *   transport, so dev pretty-print also sees `[REDACTED]`. Verified
 *   manually (out of scope for this unit test).
 * - Sentry's `beforeSend` PII scrub: separate concern, lives in
 *   `observability/sentry.ts`.
 */

import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { PINO_REDACT_PATHS } from "@/app";

function captureLogs(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines };
}

function buildLogger(stream: Writable) {
  return pino(
    {
      level: "trace",
      redact: { paths: PINO_REDACT_PATHS, censor: "[REDACTED]" },
    },
    stream,
  );
}

describe("Pino redact contract (W10-P1)", () => {
  it("redacts Authorization + Cookie request headers", () => {
    const { stream, lines } = captureLogs();
    const logger = buildLogger(stream);

    logger.info({
      req: {
        headers: {
          authorization: "Bearer eyJhbGciOiJSUzI1NiIs.SECRET",
          cookie: "session=ABC123; __Secure-token=DEF",
          "user-agent": "Mozilla/5.0",
        },
      },
    });

    const log = lines[0];
    expect(log).toContain("[REDACTED]");
    expect(log).not.toContain("eyJhbGciOiJSUzI1NiIs.SECRET");
    expect(log).not.toContain("session=ABC123");
    // Non-sensitive headers must pass through.
    expect(log).toContain("Mozilla/5.0");
  });

  it("redacts the x-api-key header in isolation (Pino bracket-notation contract)", () => {
    // Targeted assertion: log ONLY the x-api-key header so the
    // [REDACTED] presence on the line proves the bracket-notation
    // path was applied. Without this isolation, a future Pino
    // version that silently dropped bracket-notation support could
    // pass the broader "redacts headers" test on the back of
    // authorization / cookie alone.
    const { stream, lines } = captureLogs();
    const logger = buildLogger(stream);

    logger.info({
      req: {
        headers: { "x-api-key": "terk_prod_LIVE_KEY_DO_NOT_LOG" },
      },
    });

    const log = lines[0];
    expect(log).not.toContain("terk_prod_LIVE_KEY_DO_NOT_LOG");
    expect(log).toContain("[REDACTED]");
  });

  it("redacts Set-Cookie response headers", () => {
    const { stream, lines } = captureLogs();
    const logger = buildLogger(stream);

    logger.info({
      res: { headers: { "set-cookie": "session=XYZ789; HttpOnly" } },
    });

    expect(lines[0]).toContain("[REDACTED]");
    expect(lines[0]).not.toContain("session=XYZ789");
  });

  it("redacts PayDunya-style webhook body data field", () => {
    const { stream, lines } = captureLogs();
    const logger = buildLogger(stream);

    logger.info({
      req: {
        body: {
          data: '{"customer":{"email":"alice@example.com"},"amount":15000}',
          token: "PAYDUNYA_HMAC_SIGNATURE",
          signature: "sha256=abc...",
        },
      },
    });

    const log = lines[0];
    expect(log).not.toContain("alice@example.com");
    expect(log).not.toContain("PAYDUNYA_HMAC_SIGNATURE");
    expect(log).not.toContain("sha256=abc");
  });

  it("redacts PII keys (email, phoneNumber, phone) at top-level and one-level nested", () => {
    const { stream, lines } = captureLogs();
    const logger = buildLogger(stream);

    logger.info({
      email: "top-level-leak@example.com",
      phoneNumber: "+221770000000",
      user: {
        email: "nested-leak@example.com",
        phoneNumber: "+221770000001",
        phone: "+221770000002",
      },
      registration: {
        recipientEmail: "ticket-recipient@example.com",
        recipientPhone: "+221770000003",
      },
    });

    const log = lines[0];
    expect(log).not.toContain("top-level-leak@example.com");
    expect(log).not.toContain("+221770000000");
    expect(log).not.toContain("nested-leak@example.com");
    expect(log).not.toContain("+221770000001");
    expect(log).not.toContain("+221770000002");
    expect(log).not.toContain("ticket-recipient@example.com");
    expect(log).not.toContain("+221770000003");
  });

  it("redacts auth + payment tokens at one-level nested paths", () => {
    const { stream, lines } = captureLogs();
    const logger = buildLogger(stream);

    logger.info({
      auth: {
        idToken: "FIREBASE_ID_TOKEN_VALUE",
        refreshToken: "FIREBASE_REFRESH_VALUE",
        accessToken: "OAUTH_ACCESS_VALUE",
        apiKey: "API_KEY_VALUE",
        apiSecret: "API_SECRET_VALUE",
        hmacSecret: "HMAC_SECRET_VALUE",
      },
      payment: {
        paymentToken: "WAVE_PAYMENT_TOKEN",
        cardNumber: "4111111111111111",
        cvv: "123",
        pan: "4111111111111111",
      },
    });

    const log = lines[0];
    expect(log).not.toContain("FIREBASE_ID_TOKEN_VALUE");
    expect(log).not.toContain("FIREBASE_REFRESH_VALUE");
    expect(log).not.toContain("OAUTH_ACCESS_VALUE");
    expect(log).not.toContain("API_KEY_VALUE");
    expect(log).not.toContain("API_SECRET_VALUE");
    expect(log).not.toContain("HMAC_SECRET_VALUE");
    expect(log).not.toContain("WAVE_PAYMENT_TOKEN");
    expect(log).not.toContain("4111111111111111");
    expect(log).not.toContain('"cvv":"123"');
  });

  it("preserves non-sensitive structured fields", () => {
    const { stream, lines } = captureLogs();
    const logger = buildLogger(stream);

    logger.info({
      requestId: "req_123",
      method: "POST",
      url: "/v1/events",
      statusCode: 201,
      responseTime: 42,
    });

    const log = lines[0];
    expect(log).toContain("req_123");
    expect(log).toContain("/v1/events");
    expect(log).toContain('"statusCode":201');
    expect(log).toContain('"responseTime":42');
  });

  it("exposes the redact path list as a stable export (drift guard)", () => {
    // The list shape is part of the SECURITY contract — adding a new
    // sensitive field source MUST also extend this list. If the list
    // shrinks unexpectedly, this assertion catches the regression
    // before the redact is silently weakened.
    expect(PINO_REDACT_PATHS).toContain("req.headers.authorization");
    expect(PINO_REDACT_PATHS).toContain("req.headers.cookie");
    expect(PINO_REDACT_PATHS).toContain('res.headers["set-cookie"]');
    expect(PINO_REDACT_PATHS).toContain("req.body.data");
    expect(PINO_REDACT_PATHS).toContain("email");
    expect(PINO_REDACT_PATHS).toContain("*.email");
    expect(PINO_REDACT_PATHS).toContain("phoneNumber");
    expect(PINO_REDACT_PATHS).toContain("*.phoneNumber");
    expect(PINO_REDACT_PATHS).toContain("*.idToken");
    expect(PINO_REDACT_PATHS).toContain("*.paymentToken");
    expect(PINO_REDACT_PATHS.length).toBeGreaterThanOrEqual(20);
  });
});
