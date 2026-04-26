/**
 * Wave 10 / W10-P3 — Prometheus metrics surface.
 *
 * Exposed at `GET /metrics` (gated by `METRICS_AUTH_TOKEN`). Cloud
 * Monitoring's managed-Prometheus scrape pulls every 30 s in
 * production. Locally, hit it with:
 *
 *     curl -H "Authorization: Bearer $METRICS_AUTH_TOKEN" \
 *       http://localhost:3000/metrics
 *
 * Default Node metrics (event-loop lag, GC duration, RSS, heap used,
 * CPU usage) come from `prom-client` — turning autoscaling on for
 * latency / saturation requires only a Cloud Run metric mapping to the
 * counters defined here.
 *
 * Custom metrics:
 *   - http_request_duration_seconds — histogram per route + method +
 *     status_code. Buckets tuned for our SLOs (p95 < 800 ms target).
 *   - http_requests_total — counter per route + method + status_code.
 *   - business_event_total — counter for business-significant events
 *     (registrations, scans, badges) tagged by event-bus event name.
 *
 * Cardinality discipline
 * ──────────────────────
 * The `route` label is the Fastify route TEMPLATE (`/v1/events/:id`)
 * NOT the request URL — otherwise per-id cardinality explodes. The
 * onResponse hook reads `request.routeOptions.url` which is exactly
 * the template. We DROP `request.id` from labels (high cardinality)
 * and we DROP query strings (sometimes carry PII / always
 * unbounded).
 *
 * Never label-ify userId or organizationId — that would also blow up
 * cardinality. User attribution lives on Sentry's per-request scope.
 */

import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export const metricsRegistry = new Registry();

// Default Node metrics (event loop, GC, memory, CPU). Prefix
// `teranga_` so the Grafana dashboard query `teranga_*` matches every
// metric we emit and nothing else.
collectDefaultMetrics({ register: metricsRegistry, prefix: "teranga_" });

export const httpRequestDuration = new Histogram({
  name: "teranga_http_request_duration_seconds",
  help: "HTTP request duration in seconds, bucketed by route + method + status_code",
  labelNames: ["method", "route", "status_code"],
  // Buckets tuned for our SLOs — p95 target is < 800 ms; the higher
  // buckets exist so a regression to 2 s+ surfaces as its own bucket.
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1.0, 1.5, 2.5, 5.0, 10.0],
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: "teranga_http_requests_total",
  help: "Total HTTP requests, labelled by route + method + status_code",
  labelNames: ["method", "route", "status_code"],
  registers: [metricsRegistry],
});

export const businessEventTotal = new Counter({
  name: "teranga_business_event_total",
  help: "Business-significant domain events (registrations, scans, badges, broadcasts)",
  labelNames: ["event"],
  registers: [metricsRegistry],
});

/**
 * Record a Fastify response onto the histograms / counters. Called
 * from the `onResponse` hook in `app.ts`. The `route` is the route
 * template (`/v1/events/:id`) when available; falls back to "unknown"
 * for 404 / static-asset hits to keep the cardinality bounded.
 */
export function recordHttpResponse(args: {
  method: string;
  route: string | undefined;
  statusCode: number;
  responseTimeMs: number;
}): void {
  const route = args.route ?? "unknown";
  const labels = {
    method: args.method,
    route,
    status_code: String(args.statusCode),
  };
  httpRequestDuration.observe(labels, args.responseTimeMs / 1000);
  httpRequestsTotal.inc(labels);
}

/**
 * Increment the business-event counter by domain-event name. Called
 * from a tap on the event bus so the count tracks emitted events
 * regardless of which listener handled them.
 */
export function recordBusinessEvent(eventName: string): void {
  businessEventTotal.inc({ event: eventName });
}
