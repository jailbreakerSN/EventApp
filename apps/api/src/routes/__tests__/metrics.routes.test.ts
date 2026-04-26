/**
 * Pins the Wave 10 / W10-P3 `/metrics` contract.
 *
 * What we pin
 * ───────────
 *   - Default Node metrics ARE present (event-loop lag, GC, memory).
 *   - Custom metrics ARE present (http_request_duration_seconds,
 *     http_requests_total, business_event_total).
 *   - The endpoint serves Prometheus text content-type.
 *   - When `METRICS_AUTH_TOKEN` is set, an unauthenticated request
 *     gets 401.
 *   - When the token matches, the scrape succeeds.
 *
 * Anti-pattern guard: `recordHttpResponse` MUST use the route
 * TEMPLATE for the label (not the raw URL). We assert that label
 * shape on a synthetic recording so a future refactor that swaps to
 * `request.url` fails immediately — high-cardinality labels are a
 * Prometheus footgun.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { metricsRoutes } from "@/routes/metrics.routes";
import { metricsRegistry, recordHttpResponse, recordBusinessEvent } from "@/observability/metrics";

vi.mock("@/config/index", () => ({
  config: {
    METRICS_AUTH_TOKEN: "scrape-token-test-1234567890",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
  },
}));

describe("/metrics route — W10-P3 scrape contract", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  async function buildHarness() {
    const app = Fastify({ logger: false });
    await app.register(metricsRoutes);
    return app;
  }

  it("rejects unauthenticated scrape with 401 when METRICS_AUTH_TOKEN is set", async () => {
    const app = await buildHarness();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body).toMatchObject({
      success: false,
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("rejects a wrong token with 401 (constant-time compare)", async () => {
    const app = await buildHarness();
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer not-the-right-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns Prometheus text on a valid scrape", async () => {
    const app = await buildHarness();
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer scrape-token-test-1234567890" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    const body = res.body;
    // Default Node metrics — 6 representative names. If any of these
    // disappear, prom-client likely changed its default set and we
    // need to update the dashboard mappings.
    expect(body).toContain("teranga_process_cpu_user_seconds_total");
    expect(body).toContain("teranga_nodejs_eventloop_lag_seconds");
    expect(body).toContain("teranga_process_resident_memory_bytes");
    // Custom metrics MUST be registered (visible even with zero
    // observations).
    expect(body).toContain("teranga_http_request_duration_seconds");
    expect(body).toContain("teranga_http_requests_total");
    expect(body).toContain("teranga_business_event_total");
  });
});

describe("recordHttpResponse — label shape", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("uses the route template (not the URL) as the route label", async () => {
    recordHttpResponse({
      method: "GET",
      route: "/v1/events/:eventId",
      statusCode: 200,
      responseTimeMs: 42,
    });
    const dump = await metricsRegistry.metrics();
    // Counter should carry the templated route, not a per-id label.
    expect(dump).toMatch(/route="\/v1\/events\/:eventId"/);
    expect(dump).not.toMatch(/route="\/v1\/events\/abc-12345"/);
  });

  it('falls back to "unknown" when Fastify did not match a route (404)', async () => {
    recordHttpResponse({
      method: "GET",
      route: undefined,
      statusCode: 404,
      responseTimeMs: 1,
    });
    const dump = await metricsRegistry.metrics();
    expect(dump).toMatch(/route="unknown"/);
  });

  it("buckets responses into the histogram", async () => {
    recordHttpResponse({
      method: "GET",
      route: "/v1/events/:id",
      statusCode: 200,
      responseTimeMs: 120,
    });
    const dump = await metricsRegistry.metrics();
    // 120 ms = 0.12 s falls into the 0.25 bucket (and every higher one).
    expect(dump).toMatch(/teranga_http_request_duration_seconds_bucket\{[^}]*le="0.25"[^}]*\} 1/);
  });
});

describe("recordBusinessEvent — counter contract", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("increments the per-event counter", async () => {
    recordBusinessEvent("registration.created");
    recordBusinessEvent("registration.created");
    recordBusinessEvent("checkin.completed");
    const dump = await metricsRegistry.metrics();
    expect(dump).toMatch(/teranga_business_event_total\{event="registration.created"\} 2/);
    expect(dump).toMatch(/teranga_business_event_total\{event="checkin.completed"\} 1/);
  });
});
