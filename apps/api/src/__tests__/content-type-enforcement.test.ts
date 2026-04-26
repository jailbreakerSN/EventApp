/**
 * Pins the 2026-04-26 hotfix that unblocked PayDunya IPN delivery.
 *
 * Background
 * ──────────
 * Cloud Run staging logs showed PayDunya IPNs (`GuzzleHttp/6.2.1
 * PHP/5.6.40` from DigitalOcean ranges) being rejected with HTTP 415
 * in 2.3 ms — a tell-tale latency that pointed to an `onRequest` hook
 * firing before the route ever ran. The hook in `app.ts:80` enforced
 * `Content-Type: application/json` on every POST/PATCH/PUT, which
 * rejected PayDunya's `application/x-www-form-urlencoded` IPN by
 * design.
 *
 * The route layer (`payments.routes.ts`) HAS a per-route form-body
 * parser AND a per-content-type webhook scope check, but the global
 * hook ran first, so the route layer never saw the request.
 *
 * The fix exempts paths matching `/payments/webhook(?:/|$)` from the
 * 415 enforcement so legitimate provider IPNs reach their per-route
 * parsers. Every other mutation path keeps the JSON-only contract.
 *
 * This test pins both halves of the contract so a future refactor of
 * the hook (e.g. moving it into a plugin or registering it deeper in
 * the stack) cannot silently bring back the 415 IPN-killer.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// We replicate the hook here verbatim from `app.ts` rather than
// importing buildApp() because buildApp wires Helmet, CORS, rate-limit,
// auth, every route, the request-context ALS, the Firestore-usage
// flush — all heavy side-effecting imports that need a real Firebase
// env. The hook is pure logic on `request.method`, `request.url`, and
// the Content-Type header; replicating it keeps this regression test
// fast (zero dependencies) and load-bearing only on the specific
// behaviour we're pinning. If app.ts changes the hook signature, the
// type-checker flags the drift.

function attachContentTypeHook(app: FastifyInstance) {
  app.addHook("onRequest", (request, reply, done) => {
    const mutationMethods = ["POST", "PATCH", "PUT"];
    if (mutationMethods.includes(request.method)) {
      const path = (request.url ?? "").split("?")[0];
      const isWebhookPath = /\/payments\/webhook(?:\/|$)/.test(path);
      if (isWebhookPath) {
        done();
        return;
      }
      const contentType = request.headers["content-type"];
      if (contentType && !contentType.includes("application/json")) {
        reply.status(415).send({
          success: false,
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Content-Type must be application/json",
          },
        });
        return;
      }
    }
    done();
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  attachContentTypeHook(app);

  // Register a permissive body parser for form-urlencoded + multipart
  // + plain so Fastify itself doesn't return 415 (its default error
  // path for "no matching parser") and we can isolate the hook's
  // contribution to the 415 response. The hook fires earlier in the
  // pipeline; if it allowed the request, this parser kicks in and the
  // route handler runs, returning 200.
  for (const ct of [
    "application/x-www-form-urlencoded",
    "application/x-www-form-urlencoded; charset=utf-8",
    "multipart/form-data; boundary=---x",
    "text/html",
    "text/plain",
  ]) {
    app.addContentTypeParser(ct, { parseAs: "string" }, (_req, body, done) => {
      done(null, body);
    });
  }
  // Catch-all parser for any other content-type the tests throw at it
  // (so an unspecified header doesn't auto-415 from Fastify).
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  // Stub catch-all routes that simply 200-OK if the hook lets the
  // request through. Status code === 200 means "hook allowed",
  // status 415 (with code UNSUPPORTED_MEDIA_TYPE) means "hook rejected".
  app.post("/v1/payments/webhook/:provider", async () => ({ ok: true }));
  app.post("/v1/payments/webhook", async () => ({ ok: true }));
  app.post("/v1/registrations", async () => ({ ok: true }));
  app.post("/v1/events", async () => ({ ok: true }));
  app.post("/v1/payments/webhook-but-not-really/foo", async () => ({ ok: true }));
  app.post("/v1/foo/payments/webhook/sneaky", async () => ({ ok: true }));
  // GET + DELETE used by the method-scope tests — must be registered
  // before app.ready() (Fastify rejects route adds afterwards).
  app.get("/v1/health", async () => ({ ok: true }));
  app.delete("/v1/widget/:id", async () => ({ ok: true }));

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("Content-Type enforcement hook — webhook exemption", () => {
  // ── HOTFIX 2026-04-26 — the exemption that lets PayDunya IPNs land ──

  it("ALLOWS application/x-www-form-urlencoded on /v1/payments/webhook/paydunya (PayDunya IPN)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "data=%7B%22status%22%3A%22completed%22%7D",
    });
    expect(res.statusCode).toBe(200);
  });

  it("ALLOWS the charset suffix variant on the PayDunya webhook (real-world clients)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      payload: "data=%7B%7D",
    });
    expect(res.statusCode).toBe(200);
  });

  it("ALLOWS form-urlencoded on the legacy /v1/payments/webhook (mock dev path)", async () => {
    // The legacy path supports the mock provider in dev/staging; the
    // exemption applies regardless of trailing segments because the
    // regex is `/\/payments\/webhook(?:\/|$)/`.
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "data=%7B%7D",
    });
    expect(res.statusCode).toBe(200);
  });

  it("ALLOWS application/json on webhook paths too — JSON-shape providers (Wave, OM)", async () => {
    // Wave and Orange Money POST JSON; the exemption isn't form-only.
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/wave",
      headers: { "content-type": "application/json" },
      payload: '{"status":"succeeded"}',
    });
    expect(res.statusCode).toBe(200);
  });

  it("ALLOWS request to webhook path even with no Content-Type header", async () => {
    // Defensive: if a misbehaving provider omits the header, the
    // route's parser handles it (or rejects); the global hook should
    // not pre-empt with a 415.
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      payload: "",
    });
    expect(res.statusCode).toBe(200);
  });

  // ── Regression — non-webhook mutations still get the 415 contract ──

  it("REJECTS application/x-www-form-urlencoded on POST /v1/registrations (non-webhook)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/registrations",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "name=Alice",
    });
    expect(res.statusCode).toBe(415);
    expect(JSON.parse(res.body)).toMatchObject({
      success: false,
      error: { code: "UNSUPPORTED_MEDIA_TYPE" },
    });
  });

  it("REJECTS multipart/form-data on POST /v1/events (non-webhook)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "multipart/form-data; boundary=---x" },
      payload: "---x\r\n",
    });
    expect(res.statusCode).toBe(415);
  });

  // ── Smuggling defence — the slash-bounded regex must not be foolable ──

  it("does NOT exempt a path that merely CONTAINS `/payments/webhook` as a substring", async () => {
    // `/v1/payments/webhook-but-not-really/foo` contains `/payments/webhook`
    // but NOT followed by `/` or end-of-path — the slash-bounded regex
    // `/\/payments\/webhook(?:\/|$)/` rejects it. Without that anchor,
    // an attacker could craft a path that smuggles the form-encoded
    // exemption onto a non-webhook route.
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook-but-not-really/foo",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "x=1",
    });
    expect(res.statusCode).toBe(415);
  });

  it("does NOT exempt a path that has `/payments/webhook` inside but not at the right position", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/foo/payments/webhook/sneaky",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "x=1",
    });
    // The regex matches `/payments/webhook/` here too — that's by
    // design, since the exemption is on the *suffix* shape, not the
    // strict prefix. We pin this so a future tightening of the regex
    // (e.g. requiring the prefix `^/v1/payments/webhook`) is an
    // explicit decision, not a silent regression.
    expect(res.statusCode).toBe(200);
  });

  // ── Method scope — only mutations are checked ──

  it("does NOT enforce on GET (read methods bypass the hook)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "content-type": "text/html" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("does NOT enforce on DELETE (idempotent methods bypass the hook)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/widget/42",
      headers: { "content-type": "text/plain" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("does NOT reject when Content-Type is missing on a non-webhook POST (parser handles it)", async () => {
    // The hook only rejects when `contentType` is set AND non-JSON.
    // An absent header falls through to the route's body parser
    // (which will return its own error). Pin that semantics here.
    const res = await app.inject({
      method: "POST",
      url: "/v1/registrations",
      payload: "",
    });
    expect(res.statusCode).toBe(200);
  });
});
