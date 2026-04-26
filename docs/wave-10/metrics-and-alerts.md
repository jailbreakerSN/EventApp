# Wave 10 / W10-P3 — Metrics + alerts

**Branch:** `claude/wave-10-production-hardening`
**Status:** shipped
**Audits closed:** O4 (`/metrics` endpoint), O5 (alert + dashboard coverage)

Includes the carry-over from the W10-P2 security review: WhatsApp delivery audit row's `recipient` PII redacted to last-4 digits; `.env.example` documentation for `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` + `NEXT_PUBLIC_CSP_ENFORCE`; isolated `x-api-key` Pino redact assertion.

---

## What changed

### 1. Prometheus metrics module

**Where:** `apps/api/src/observability/metrics.ts`. New module exports a `metricsRegistry` (`prom-client`) seeded with default Node metrics (event-loop lag, GC duration, RSS, heap used, CPU usage), all prefixed `teranga_`.

Custom metrics:

| Metric                                  | Type      | Labels                           | Used for                                                      |
| --------------------------------------- | --------- | -------------------------------- | ------------------------------------------------------------- |
| `teranga_http_request_duration_seconds` | histogram | `method`, `route`, `status_code` | latency p50 / p95 / p99 SLOs                                  |
| `teranga_http_requests_total`           | counter   | `method`, `route`, `status_code` | request rate, 5xx ratio                                       |
| `teranga_business_event_total`          | counter   | `event`                          | RPS for KPI events (registrations, scans, badges, broadcasts) |

**Cardinality discipline:** the `route` label is the Fastify route TEMPLATE (`/v1/events/:id`), never the URL. Pinned by `apps/api/src/routes/__tests__/metrics.routes.test.ts`. Per-id labels would explode cardinality; the templated label keeps the dashboard usable.

### 2. `/metrics` endpoint

**Where:** `apps/api/src/routes/metrics.routes.ts`.

- Path: `GET /metrics` — registered first, before any `/v1` route prefix.
- Auth: token-based via `METRICS_AUTH_TOKEN` env. Bearer header constant-time compared. When the token is unset (local dev), the endpoint is open. The production deploy workflow (P5) will fail-build if the token is missing.
- Rate limit: explicitly disabled (`config.rateLimit: false`) so a fixed-frequency scrape job can't clip itself.
- Hidden from OpenAPI (`schema.hide: true`) — internal only.

Cloud Run scrape config:

```
gcloud run services update teranga-api \
  --update-annotations='run.googleapis.com/prometheus-scrape-port=3000' \
  --update-env-vars=METRICS_AUTH_TOKEN=<rotatable-secret>
```

### 3. Wiring

- `app.ts` — the existing `onResponse` hook now also calls `recordHttpResponse({ method, route, statusCode, responseTimeMs })`. Reads `request.routeOptions?.url` for the templated route.
- `app.ts` — a curated `METRICS_OBSERVED_EVENTS` allow-list (15 events) is tapped on the event bus; each emit increments `business_event_total`. The list is conservatively scoped to keep label cardinality bounded.

### 4. Cloud Monitoring alert policies

Four new YAML files in `infrastructure/monitoring/`:

| File                           | Threshold                     | Routes to         |
| ------------------------------ | ----------------------------- | ----------------- |
| `api-5xx-rate.yaml`            | 5xx ratio ≥ 1 % over 10 min   | Slack + PagerDuty |
| `api-latency-p95.yaml`         | p95 ≥ 1.5 s over 10 min       | Slack             |
| `ready-probe-failure.yaml`     | `/ready` 5xx for 2 min        | Slack + PagerDuty |
| `payment-webhook-failure.yaml` | webhook 4xx ≥ 5 % over 15 min | Slack + PagerDuty |

Each YAML follows the existing `notification-bounce-rate-*.yaml` pattern: provisioned via `gcloud` from CI; channels list is empty in the file (the deploy workflow injects per-env channel ids); inline runbook links point at `docs/runbooks/incident-response.md`.

### 5. Operator dashboard

**Where:** `infrastructure/monitoring/dashboards/api-overview.json`. RED dashboard:

- Row 1: request rate (stacked area by status class) + 5xx ratio with a red threshold at 1 %.
- Row 2: duration p50 / p95 / p99 with yellow / red thresholds at 0.8 s / 1.5 s.
- Row 3: business KPIs — registrations / hour, check-ins / hour, badges generated / hour.
- Row 4: event-loop lag + resident memory.

### 6. P2 follow-ups (carry-over from the security review)

- **WhatsApp delivery audit row PII.** `audit.listener.ts:1920` previously persisted the raw E.164 phone number into `details.recipient`. Replaced with `recipientLast4` (last 4 digits) so the audit row stays useful for "did failures cluster on one MNO" triage without carrying PII. The full recipient lives on `whatsappDeliveryLog/{messageId}__{status}` for forensic join.
- **Documentation.** `apps/web-{backoffice,participant}/.env.example` — added `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_CSP_ENFORCE` stubs with inline rationale.
- **Test isolation.** `apps/api/src/__tests__/log-redaction.test.ts` — split out the `x-api-key` redaction case so a future Pino regression on bracket-notation paths fails cleanly.

---

## Verification log

- `cd apps/api && npx vitest run` — 135 files / 2130 tests green.
- `cd apps/api && npx tsc --noEmit` — clean.
- New metrics route test: 7 / 7 green (auth gate + content-type + label shape).
- `route-inventory` snapshot refreshed to include `GET /metrics`.

## Mechanical auditor results

- `@security-reviewer` — to run on this commit.
- `@firestore-transaction-auditor` — N/A.
- `@domain-event-auditor` — N/A (the bus tap reads, never emits).

---

## What remains for the next phase

- `/metrics` is wired but not yet scraped — the production deploy workflow (P5) will provision the Prometheus scrape annotation + the `METRICS_AUTH_TOKEN` env on Cloud Run.
- Channel routing for the four new alert YAMLs — the deploy workflow's `gcloud alpha monitoring policies update --add-notification-channels=` step needs the per-env Slack + PagerDuty channel ids (already wired for the bounce-rate alert; mirror).
- The `dashboard/api-overview.json` is committed but not yet provisioned. Add a `gcloud monitoring dashboards create --config-from-file` step in the production deploy workflow.

## Rollback

| Change                   | Rollback                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/metrics` endpoint      | Drop the route registration line in `routes/index.ts`; the prom-client registry stays in memory but is unreachable.                                            |
| Metrics tap in `app.ts`  | Remove the `for (const eventName of METRICS_OBSERVED_EVENTS)` block; the rest of the bus continues unchanged.                                                  |
| Alert YAMLs              | `gcloud alpha monitoring policies delete <id>` for each.                                                                                                       |
| Dashboard                | `gcloud monitoring dashboards delete <id>`.                                                                                                                    |
| WhatsApp audit redaction | Re-add `recipient: payload.recipient`. The PII pattern in W10-P2 § "Audit policy" comment still holds, so the revert intentionally violates documented intent. |
