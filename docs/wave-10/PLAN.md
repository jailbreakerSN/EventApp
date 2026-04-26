# Wave 10 — Production Hardening Plan

> **Branch:** `claude/wave-10-production-hardening`
> **Status:** in flight (2026-04-26)
> **Inputs:** 4 parallel senior audits — Observability, Security, Performance / Reliability, Operations / Web-launch.
> **Outcome:** every Wave-10 launch-criteria item in `docs/delivery-plan/wave-10-launch.md` either implemented, codified, or explicitly deferred with a follow-up issue.

---

## Why this plan exists

Wave 1–9 delivered the product surface (organizer overhaul O1–O10 included). Wave 10 closes the gap between "feature-complete" and "production-ready". The 20 senior findings below are NOT new features — they are the items that, if missed, would surface as a P0 incident in the first 30 days post-launch:

- invisible client-side errors (no frontend Sentry),
- logged secrets (no Pino redact),
- CSP-less XSS surface,
- unbounded Firestore queries timing out for enterprise tenants,
- manual-only Cloud Run deploy with staging-tier flags leaking forward,
- no on-call procedure, no DR cron, no metrics for autoscaling.

Each phase below is a self-contained PR-able unit: audits → fix → tests → snapshot refresh → architecture note → commit + push. The sequence is non-arbitrary: observability **must** ship first so subsequent phases land with telemetry. Security hardening then closes the public exposure. Performance + ops + launch prep follow once we can see the system.

---

## Audit synthesis (20 findings, ranked)

| #   | Finding                                                                               | Severity       | Effort | Phase   |
| --- | ------------------------------------------------------------------------------------- | -------------- | ------ | ------- |
| O1  | No Pino redact — PII / Authorization / payment metadata leak into Cloud Logging       | CRITICAL       | S      | P1      |
| O2  | Frontend error + perf tracking absent on both Next.js apps                            | CRITICAL       | M      | P1      |
| O3  | Outbound dependency tracing unstructured (no Firestore / dispatcher spans)            | HIGH           | M      | P1      |
| O4  | No `/metrics` endpoint for autoscaling / SLOs                                         | HIGH           | M      | P3      |
| O5  | Alert + dashboard coverage one-feature-deep (only bounce rate today)                  | HIGH           | M      | P3      |
| S1  | CSP not shipped on either Next.js app                                                 | P0             | M      | P2      |
| S2  | Firestore rules missing for O8–O10 collections (incidents, magicLinks, ...)           | P0             | M      | P2      |
| S3  | Rate-limit holes on magic-links / WhatsApp / feed / messaging routes                  | P0             | S      | P2      |
| S4  | PII leakage in audit log details (newsletter, member-invited still inline emails)     | P1             | S      | P2      |
| S5  | Secret rotation runbook missing                                                       | P1             | M      | P5      |
| R1  | No production deploy pipeline (only `deploy-staging.yml`); staging flags risk leaking | LAUNCH BLOCKER | M      | P5      |
| R2  | Unbounded `limit: 10000` full-collection scans in 6 services                          | HIGH           | M      | P4      |
| R3  | Plan-impact preview N+1 in `plan.service.ts:490`                                      | HIGH           | S      | P4      |
| R4  | Firestore index audit strict run = `continue-on-error`; ~30 missing facet shapes      | MEDIUM-HIGH    | M      | P4      |
| R5  | Backup automation undocumented + participant SSG forced dynamic                       | MEDIUM         | M      | P5 + P6 |
| L1  | No production deploy pipeline (duplicate w/ R1)                                       | CRITICAL       | M      | P5      |
| L2  | Custom domains undocumented + CSP deferred                                            | HIGH           | M      | P2 + P6 |
| L3  | No Firestore scheduled-export cron — DR depends on operator click                     | HIGH           | S      | P5      |
| L4  | No cookie consent + Senegal Loi 2008-12 compliance gaps                               | MEDIUM-HIGH    | M      | P6      |
| L5  | No on-call rotation / incident response / launch-metrics dashboard                    | MEDIUM         | M      | P5 + P6 |

Cross-cutting de-dup: R1 ≡ L1; L2's CSP half is folded into P2, the domain runbook half into P6.

---

## Phase plan

### W10-P1 — Observability foundation

**Why first:** every subsequent phase needs telemetry to verify itself. Shipping Pino redact before the security sweep also prevents PII leaking through the work-in-progress logs of the very fixes we're landing.

- Pino `redact: { paths, censor }` block in `apps/api/src/app.ts` covering `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.email`, `*.phoneNumber`, `*.paymentToken`, `data` (PayDunya IPN body), `signature`, plus a unit test under `apps/api/src/__tests__/log-redaction.test.ts`.
- Add `@sentry/nextjs` to both web apps. Generate `sentry.client.config.ts` + `sentry.server.config.ts` + `sentry.edge.config.ts` per app; wrap `next.config.ts` in `withSentryConfig`. Mirror the API's filter posture (5xx-only on server, denylist health probes).
- Pipe Web Vitals (LCP / INP / CLS / TTFB) through Next 14 `instrumentation.ts` → Sentry.
- Replace the `onReport` TODO at `apps/web-participant/src/hooks/use-error-handler.ts:45` with `Sentry.captureException`.
- Wrap `BaseRepository` reads + writes in `Sentry.startSpan({ op: 'db.firestore', name })` so the dominant latency source attaches to the parent request span.
- Push `request.user` into `Sentry.setUser()` in the auth middleware so per-user error attribution works.

**Tests:** new `log-redaction.test.ts`; existing route + service suites must stay green; snapshot refresh on the Sentry init path is not required (init code is unmocked).

**Architecture note:** `docs/wave-10/observability.md` covering the redact policy, the Sentry split between API + Next, the Web Vitals plumbing, and the operator runbook for "an error in Sentry → which Cloud Logging request id".

---

### W10-P2 — Security hardening

- **CSP.** Strict policy on both `next.config.ts` files. `script-src 'self' 'nonce-{nonce}' https://*.googleapis.com https://*.firebaseapp.com https://*.gstatic.com`, `connect-src` allow-listing Firebase + Resend + PayDunya + WhatsApp Cloud + Sentry, `frame-ancestors 'none'`, `report-to` reporter group. Ship in **Report-Only** mode behind a build-flag for the first deploy; promote to enforce after a 1-week clean window. Update `helmet` in `apps/api/src/app.ts` with the same `Report-Only` posture for non-asset responses.
- **Firestore rules.** Add explicit `match /{collection}/{doc}` blocks for `incidents`, `staffMessages`, `magicLinks`, `whatsappOptIns`, `whatsappDeliveryLog`, `participantProfiles`. Pattern: `allow read: if hasOrgRole(eventOrgId)` (per-collection scoped) + `allow create, update, delete: if false` since all writes go via the API. Add fixtures in `infrastructure/firebase/__tests__/firestore.rules.test.ts`.
- **Rate-limit overrides.** Per-route `config.rateLimit` on:
  - `magic-links.routes.ts` — issuance 5 / min, verify 30 / min,
  - `whatsapp.routes.ts` — opt-in 10 / min,
  - `feed.routes.ts` — POST / DELETE 30 / min,
  - `messaging.routes.ts` — POST 30 / min,
  - incident creation endpoint — 30 / min.
- **Audit PII redaction.** Replace `details: { email: payload.email }` at `audit.listener.ts:769, 786, 974, 1016` with `details: {}` (resourceId already carries `userId`). Introduce `redactPiiFromDetails(details)` helper + lint rule preventing `email` / `phoneNumber` keys from landing in `details`.

**Tests:** route-level rate-limit tests asserting 429 after N requests, Firestore rules unit tests for each new collection, audit-listener tests assert no PII keys.

**Architecture note:** `docs/wave-10/security-hardening.md` documenting CSP policy + Report-Only ramp, Firestore rules contract, rate-limit budgets.

---

### W10-P3 — Metrics + alerts

- `prom-client` default Node metrics + a per-route histogram (request rate / error rate / duration p50/p95/p99) installed in an `onResponse` hook.
- `GET /metrics` endpoint gated by `requireMetricsToken` middleware (shared secret in env, no public exposure). Compatible with Cloud Monitoring's managed-Prometheus scrape.
- Four new YAML alert policies in `infrastructure/monitoring/`:
  - `api-5xx-rate.yaml` — sustained > 1 % 5xx over 10 min,
  - `api-latency-p95.yaml` — p95 > 1.5 s for 10 min,
  - `ready-probe-failure.yaml` — `/ready` failing for 2 min,
  - `payment-webhook-failure.yaml` — sustained provider 4xx ≥ 5 % over 15 min.
- `infrastructure/monitoring/dashboards/api-overview.json` — RED dashboard (request rate, error rate, duration) + business KPI strip (registrations / hour, scans / hour, badges issued / hour).

**Tests:** unit test on the metrics middleware shape; a CI smoke-step that `curl`s `/metrics` post-deploy and grep's a known counter.

**Architecture note:** `docs/wave-10/metrics-and-alerts.md`.

---

### W10-P4 — Performance + reliability

- **`BaseRepository.update` / `softDelete` race window.** The current `doc.get()` → `if (!exists) throw` → `docRef.update()` sequence (raised by the W10-P1 transaction auditor as a pre-existing pattern) needs to either drop the pre-read (Firestore's `update()` throws `not-found` natively, giving the same 404 semantics atomically) or wrap each call in `db.runTransaction()`. The pre-read variant is preferred — simpler, fewer reads, identical caller-facing error.
- **Pagination cap.** Add `MAX_PAGE_SIZE = 1000` in `BaseRepository`. Refactor `payout.service.ts:69, 122`, `reconciliation.service.ts:44`, `sponsor.service.ts:260`, `post-event-report.service.ts:63, 66`, `messaging.service.ts:31, 32`, `event-health.service.ts:241` to use cursor pagination via `startAfter`. Document the cursor contract in the OpenAPI export.
- **Plan-impact preview.** Replace the sequential loop in `plan.service.ts:490–501` with `db.getAll(...)` + `Promise.all` for the count queries (mirror `admin.service.ts:2147`).
- **Firestore index gap closure.** Run `npm run audit:firestore-indexes:strict`; commit the missing composite indexes for the participant-search facets. Flip the strict step from `continue-on-error: true` to a hard fail in `deploy-staging.yml`.
- **React Query staleTime.** Add `staleTime: 60_000` to long-lived queries (event details, plan tiers, organization, current user) in both web apps.

**Tests:** service tests for pagination boundary (limit + 1, cursor round-trip), the plan-impact preview, and firestore-rules round-trip on the new indexes.

**Architecture note:** `docs/wave-10/performance.md`.

---

### W10-P5 — Operational readiness

- **Production deploy workflow.** New `.github/workflows/deploy-production.yml` triggered by tags `release/v*` and pushes to `main`, hard-coded to `teranga-events-prod`. Cloud Run prod-tier flags: `--min-instances 1 --max-instances 20 --cpu 2 --memory 1Gi --cpu-boost --concurrency 40`. Required reviewer via GH Environment `production`.
- **Scheduled backup.** Add `apps/functions/src/triggers/scheduled-backup.scheduled.ts` running daily at 02:00 Africa/Dakar; idempotent IAM binding step in the deploy workflow creating the Cloud Scheduler job if absent.
- **Secret rotation runbook.** `docs/runbooks/secret-rotation.md` covering `QR_SECRET` (with `kid` rotation against `qrKidHistory`), `PAYDUNYA_MASTER_KEY`, `WHATSAPP_APP_SECRET`, `RESEND_API_KEY`, `WEBHOOK_SECRET`, the magic-link HMAC (today coupled to `QR_SECRET` — call out the gotcha), org-API keys (`terk_*` rotation flow). Each section: blast radius, rotation steps, dual-running window, verification, audit emission.
- **On-call + incident-response runbooks.** `docs/runbooks/on-call-rotation.md` + `docs/runbooks/incident-response.md`. Sev triage matrix, escalation tree, GCP support number, comms templates, status-page mention, post-mortem template.
- **Quarterly DR drill.** Add to `scheduled-ops.md`.

**Tests:** none required (workflow + docs); deploy workflow validated by a dry-run via `act` or by branching to a sandbox project before merging.

**Architecture note:** `docs/wave-10/operations.md`.

---

### W10-P6 — Web launch prep

- **ISR + cache headers.** Convert `apps/web-participant/src/app/(public)/events/[slug]/page.tsx` and `events/page.tsx` from `force-dynamic` to ISR with `revalidate: 60` + `Cache-Control: s-maxage=60, stale-while-revalidate=300`.
- **Cookie consent.** French-first banner blocking GA + Sentry until accepted. Wire to `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` and Sentry init. Document `me.routes.ts` DSAR endpoints in a participant-side `Mes données` page.
- **Custom domain runbook.** `docs/runbooks/custom-domains.md` — Cloud Run domain mapping + DNS at the `.sn` registrar + SSL verification + the `vars.*_PUBLIC_URL` flip.
- **Launch metrics dashboard.** `platformAnalytics.service.ts` + `/admin/launch-metrics` page surfacing DAU, active orgs, registrations / day, check-in rate, error rate. Super-admin only.
- **Lighthouse CI scope.** Verify it runs on `/events/[slug]` (highest SEO surface), not just `/`.

**Tests:** route + service tests for `platformAnalytics.service.ts`; visual check for the consent banner; ISR build assertion.

**Architecture note:** `docs/wave-10/web-launch.md`.

---

## Cross-phase invariants

- **No regression in test count.** Baseline: 2092 API tests + 308 web tests after PR #200. Each phase commits an updated count.
- **Snapshots refreshed in the same commit** as the code change (route-inventory, permission-matrix, contract-snapshots, audit-listener handler count).
- **All 6 project subagents invoked locally before each push** (`@security-reviewer`, `@firestore-transaction-auditor`, `@domain-event-auditor`, `@plan-limit-auditor`, `@l10n-auditor`, `@test-coverage-reviewer`). Findings either fixed or explicitly deferred with rationale.
- **PR description updated on every push** (cumulative scope).
- **Architecture note per phase** in `docs/wave-10/`.

---

## Out of scope (explicitly deferred)

- Wave-9 mobile app completion — owned by mobile track, separate branch.
- Memorystore (Redis) for the rate-limit store — only required when `min-instances ≥ 2`. Document in `operations.md` as the next milestone.
- Bulk badge generation moved to Pub/Sub worker — flagged in `performance.md`, not implemented in Wave 10. Workaround: cap concurrency to 40 per Cloud Run instance.
- Full TCF v2 IAB consent string — overkill for the Senegal market; we ship a CDP-aligned in-house gate.

---

## Rollback strategy

Each phase commit can be reverted independently. The riskier phases:

| Phase            | Rollback action                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P1 (redact)      | `git revert` of the redact block; logs go back to verbose. No data loss.                                                         |
| P2 (CSP)         | CSP ships in `Report-Only` first → no enforcement risk. Promote to `Content-Security-Policy` only after a clean week of reports. |
| P3 (/metrics)    | Endpoint is internal-token-gated; revert removes the route. No data loss.                                                        |
| P4 (pagination)  | Cursor pagination is additive; old `limit` API stays valid until callers migrate.                                                |
| P5 (prod deploy) | Land workflow gated on `vars.PRODUCTION_DEPLOY_ENABLED == 'true'` until ops sign-off.                                            |
| P6 (ISR)         | `force-dynamic` is a one-line revert.                                                                                            |

---

## Sign-off checklist (PR description must include)

- [ ] All 6 phases land or carry an explicit deferral note.
- [ ] 4 senior audits re-run on the final diff (security / transactions / domain-events / plan-limits) — green.
- [ ] `cd apps/api && npx vitest run` — green.
- [ ] `cd apps/api && npx tsc --noEmit` — green.
- [ ] `cd apps/web-backoffice && npx tsc --noEmit` — green.
- [ ] `cd apps/web-participant && npx tsc --noEmit` — green.
- [ ] `npm run build` — green.
- [ ] CSP `Report-Only` deployed to staging for 7 days with zero violations on the canary path.
- [ ] Production deploy workflow dry-run logged in PR.
- [ ] `docs/wave-10/` notes complete for every phase.
