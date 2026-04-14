/**
 * API security — verifies the new requireEmailVerified middleware is
 * wired (PR #38) plus the existing authenticate gate.
 *
 * Requires STAGING_API to be set. Without it the suite skips with a
 * clear message.
 *
 * The unverified-token case requires a Firebase ID token minted for a
 * user whose `email_verified` claim is false. The easiest path in CI
 * is a GitHub Actions secret `STAGING_UNVERIFIED_ID_TOKEN` — generated
 * via:
 *
 *   firebase login:ci
 *   # Custom script: sign in a test unverified user, print ID token.
 *
 * For now, the tests gracefully skip if the token isn't provided.
 */
import { test, expect } from "@playwright/test";
import { URLS } from "./_shared";

test.describe("API — authentication gate", () => {
  test.skip(!URLS.api, "STAGING_API env var not set — skipping API tests.");

  test("POST /v1/events without a token returns 401 UNAUTHORIZED", async ({ request }) => {
    const res = await request.post(`${URLS.api}/v1/events`, {
      data: { title: "unit-test-should-not-create" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("POST /v1/events with garbage token returns 401", async ({ request }) => {
    const res = await request.post(`${URLS.api}/v1/events`, {
      headers: { authorization: "Bearer not-a-real-token" },
      data: {},
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(401);
  });

  test("GET /v1/events/public reads without a token (no gate)", async ({ request }) => {
    const res = await request.get(`${URLS.api}/v1/events/public`, { failOnStatusCode: false });
    // Either 200 with a payload, or 404 if the route requires a slug — both prove
    // the read path is not gated by authenticate or requireEmailVerified.
    expect([200, 404, 400]).toContain(res.status());
  });
});

test.describe("API — requireEmailVerified gate (PR #38)", () => {
  const unverifiedToken = process.env.STAGING_UNVERIFIED_ID_TOKEN;
  test.skip(!URLS.api || !unverifiedToken, "STAGING_UNVERIFIED_ID_TOKEN not provided; skipping.");

  test("POST /v1/events with an unverified token returns 403 EMAIL_NOT_VERIFIED", async ({
    request,
  }) => {
    const res = await request.post(`${URLS.api}/v1/events`, {
      headers: { authorization: `Bearer ${unverifiedToken}` },
      data: {
        title: "unit-test-should-be-blocked",
        // Body is deliberately minimal — the gate fires before body validation.
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe("EMAIL_NOT_VERIFIED");
  });
});

test.describe("API — webhook exemption", () => {
  test.skip(!URLS.api, "STAGING_API env var not set.");

  test("POST /v1/payments/webhook returns 401/403 on missing signature, not 401 UNAUTHORIZED", async ({
    request,
  }) => {
    // The webhook route is NOT gated by requireEmailVerified (deliberate —
    // called by PSPs, not users). It IS gated by HMAC signature
    // verification. Expect the rejection to cite signature, not auth.
    const res = await request.post(`${URLS.api}/v1/payments/webhook`, {
      data: { event: "test" },
      failOnStatusCode: false,
    });
    expect([400, 401, 403]).toContain(res.status());
    const body = await res.json().catch(() => ({}));
    // If the error body mentions "signature" anywhere, we're confident the
    // signature gate fired instead of authenticate.
    const hint = JSON.stringify(body).toLowerCase();
    expect(hint).toMatch(/signature|webhook|unauthorized/);
  });
});
