# Wave 10 / W10-P1 — Observability foundation

**Branch:** `claude/wave-10-production-hardening`
**Status:** shipped
**Audits closed:** O1 (Pino redact), O2 (frontend Sentry), O3 (outbound tracing)

---

## What changed

### 1. Pino redact (CRITICAL / S)

**Where:** `apps/api/src/app.ts` — added a top-level `PINO_REDACT_PATHS` array (exported for the unit test) plus a `redact: { paths, censor: "[REDACTED]" }` block on the Fastify logger options.

**What it covers:**

| Path family      | Examples                                                                                            | Why                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Request headers  | `req.headers.authorization`, `req.headers.cookie`, `req.headers['x-api-key']`                       | Firebase ID tokens, org API keys (`terk_*`), session cookies. Anyone with `logging.viewer` IAM could otherwise impersonate any caller. |
| Response cookies | `res.headers["set-cookie"]`                                                                         | Symmetrical guard.                                                                                                                     |
| Webhook bodies   | `req.body.data`, `req.body.token`, `req.body.signature`                                             | PayDunya IPN body carries customer email + payment metadata; webhook routes legitimately log the body for observability.               |
| PII keys         | `email`, `phoneNumber`, `phone`, `*.email`, `*.phoneNumber`, `*.recipientEmail`, `*.recipientPhone` | Senegal Loi 2008-12 + GDPR alignment. Defense-in-depth for free-form `request.log.info({ user })` calls.                               |
| Auth tokens      | `*.idToken`, `*.refreshToken`, `*.accessToken`, `*.apiKey`, `*.apiSecret`, `*.hmacSecret`           | Belt-and-braces against accidental token logging.                                                                                      |
| Payment surface  | `*.paymentToken`, `*.cardNumber`, `*.cvv`, `*.pan`                                                  | PCI-adjacent data must never reach Cloud Logging.                                                                                      |

**Test:** `apps/api/src/__tests__/log-redaction.test.ts` — 7 assertions, ~13 ms. Imports `PINO_REDACT_PATHS` directly from `app.ts` so a list shrink fails CI in lockstep.

**Operator note:** Pino redact runs BEFORE the dev pretty-print transport, so local `pnpm api:dev` sessions also see `[REDACTED]`. The redaction is one-way; if a debugger needs full body content, set `LOG_LEVEL=trace` AND temporarily comment out the `redact` block in a local branch. Never deploy a redact-disabled build.

### 2. Frontend Sentry (CRITICAL / M)

**Where:** both `apps/web-backoffice` and `apps/web-participant`.

- `package.json` — added `@sentry/nextjs ^8.55.1` matching the API's `@sentry/node` version.
- `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` per app.
- `next.config.ts` wrapped in `withSentryConfig({ ... })`.
- `instrumentation.ts` at app root — Next 15 hook that dynamic-imports the matching server / edge config. Re-exports `captureRequestError as onRequestError` so Next's request-error hook lands in Sentry.

**Wiring contract:**

- Client config calls `setErrorReporter(...)` from `@teranga/shared-types` so every `useErrorHandler().resolve(err)` call (registered today on every mutation in the participant app) lands in Sentry tagged with `error.code` / `error.reason` / `error.status`.
- Server config uses the same 5xx-only `beforeSend` filter as the API.
- `sendDefaultPii: false` everywhere — the user uid is set via `Sentry.setUser({ id })` post-auth (the API mirror for this lives in `setSentryUser`); email + IP are never shipped.

**Sampling:**

- `tracesSampleRate: 0.1` — same as the API.
- Backoffice replays disabled.
- Participant: `replaysOnErrorSampleRate: 1.0`, `replaysSessionSampleRate: 0.05`. The participant app is the public funnel and reproducing a flaky-network bug is hardest there.

**DSN env vars:**

- `NEXT_PUBLIC_SENTRY_DSN` — browser, public.
- `SENTRY_DSN` — server, falls back to `NEXT_PUBLIC_SENTRY_DSN`.
- `SENTRY_ORG`, `SENTRY_AUTH_TOKEN`, `SENTRY_PROJECT_BACKOFFICE`, `SENTRY_PROJECT_PARTICIPANT` — build-time, source-map upload only. `errorHandler: () => undefined` lets the build succeed without these (no source-map upload, runtime SDK still works).

### 3. Outbound dependency tracing (HIGH / M)

**Where:** `apps/api/src/observability/sentry.ts` — added `withSpan({ op, name, data? }, callback)` and `setSentryUser({ uid, organizationId })`.

`apps/api/src/repositories/base.repository.ts` — every read + write public method (`findById`, `findMany`, `findOne`, `exists`, `create`, `createWithId`, `update`, `softDelete`, `increment`, `batchGet`) is wrapped in `withSpan({ op: "db.firestore", name: \`${resourceName}.<verb>\` }, ...)`.

**Conventions for `op`:**

| op             | Used by                                                           |
| -------------- | ----------------------------------------------------------------- |
| `db.firestore` | every BaseRepository call                                         |
| `http.client`  | future wrapped HTTP helpers                                       |
| `channel.send` | notification dispatcher channel adapters (Wave 10 P3 follow-up)   |
| `pdf.render`   | pdf-lib + canvas badge / receipt rendering (Wave 10 P3 follow-up) |

**Conventions for `name`:** `<resource>.<verb>` — e.g. `events.findById`, `users.batchGet`. The resource name comes from `BaseRepository.resourceName` (already populated by every concrete repository).

**Behaviour when Sentry is not initialised** — `withSpan` short-circuits to the bare callback, no overhead, no broken traces.

**Behaviour with no parent transaction** — `Sentry.startSpan` creates a root span. Acceptable for cron + listener paths that don't have a parent request transaction.

### 4. Per-request user attribution (cross-tenant safe)

**Where:** `apps/api/src/app.ts` — the existing `enrichContext(request.user.uid, request.user.organizationId)` preHandler hook now also calls `setSentryUser({ uid, organizationId })`.

**Cross-tenant safety:** Cloud Run runs many concurrent requests in one Node process. Calling `Sentry.setUser()` / `Sentry.setTag()` directly writes to the GLOBAL scope and would leak Request A's `organizationId` onto Request B's exception. `setSentryUser` writes to `Sentry.getIsolationScope()` instead — Sentry's httpIntegration scopes that per-async-context (per HTTP request), keeping attribution request-local. The contract is pinned by `apps/api/src/observability/__tests__/sentry.test.ts` so a future refactor that reaches for the global scope fails CI.

With `sendDefaultPii: false` set globally we only ship the uid.

### 5. Session Replay — explicitly NOT enabled

**Where:** `apps/web-participant/sentry.client.config.ts`. The participant app surfaces personal data (name / email / phone / payment) during registration; activating Sentry Session Replay without `maskAllInputs: true` + `blockAllMedia: true` would ship form contents to Sentry. We do NOT register `replayIntegration()` and we do NOT set `replays*SampleRate` — both deferred to a Wave 10 follow-up that ships PII masking + cookie consent first. The rationale is documented inline so a future contributor cannot enable Replay without re-reading the constraint.

---

## What remains for the next phase

- `apps/api/src/__tests__/setup.ts` is unchanged — span wrapping is transparent to existing service / route tests.
- No snapshot refresh needed (no enum / schema change).
- No new audit actions.

## Rollback

Each item is a single-commit revert:

- Pino redact — strips the `redact:` block from `app.ts`, restores the test as a no-op.
- Frontend Sentry — drops `@sentry/nextjs` from package.json, deletes the 3 config files + instrumentation.ts, removes `withSentryConfig` wrap. Both web apps revert to bare Next.
- Outbound tracing — removes the `withSpan` import + wrap calls from BaseRepository.

---

## Verification log

- `cd apps/api && npx vitest run` — 133 files / 2117 tests green.
- `cd apps/api && npx tsc --noEmit` — clean.
- `cd apps/web-backoffice && npx tsc --noEmit && npx vitest run` — clean / 39 files / 308 tests green.
- `cd apps/web-participant && npx tsc --noEmit && npx vitest run` — clean / 2 files / 16 tests green.
- `apps/api/src/__tests__/log-redaction.test.ts` — 7 / 7 redact assertions green.
- `apps/api/src/observability/__tests__/sentry.test.ts` — 6 / 6 cross-tenant + pass-through assertions green.

## Mechanical auditor results

- `@security-reviewer` — initial run flagged 1 FAIL (cross-tenant Sentry scope leak in `setSentryUser` — fixed by routing through `getIsolationScope()` and pinning the property in a unit test) + 1 NEEDS HUMAN (latent Replay PII risk — fixed by removing the inert `replays*SampleRate` config and documenting the constraint inline).
- `@firestore-transaction-auditor` — green for this diff. Pre-existing read-then-write in `BaseRepository.update` / `softDelete` flagged for W10-P4.
- `@domain-event-auditor` — green; observability instrumentation introduces no mutations.
- `@test-coverage-reviewer` — green; redact contract pinned, isolation-scope pinned, no stale snapshots.
