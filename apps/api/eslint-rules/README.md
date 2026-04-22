# apps/api/eslint-rules

Project-local ESLint custom rules for the Teranga API. Consumed by the
root `eslint.config.mjs` via an inline plugin wrapper so everything
stays in a single flat-config file — no plugin package to publish.

## Rules

### `no-direct-email-service` (warn)

Blocks direct calls to `emailService.sendXxx()` outside the dispatcher
path. After Phase 2.2 lands, every new email-producing call site must
go through `notificationDispatcher.dispatch(...)` so the platform
gets:

- catalog lookup + template resolution
- admin kill-switch (`notificationSettings/{key}`)
- per-key user opt-out (`notificationPreferences/{uid}.byKey`)
- audit trail via `notification.sent` / `notification.suppressed` /
  `notification.deduplicated`
- persistent idempotency dedup (Phase 2.2)

**Current severity: `warn`.** The remaining `emailService.sendXxx`
shims inside `email.service.ts` itself are explicitly allow-listed so
they don't trip the rule during the flag-gated rollout
(`NOTIFICATIONS_DISPATCHER_ENABLED` defaults to `false` in prod).

> **TODO:** flip severity to `error` once Phase 2.3 has soaked in
> staging for a full week and the shims are deleted. Tracked in
> `docs/notification-system-roadmap.md`.

#### Allow-list

The rule is **not** applied to:

- `apps/api/src/services/email.service.ts` (the shims themselves)
- `apps/api/src/services/notification-dispatcher.service.ts`
- any file under `__tests__/` or matching `*.test.ts` / `*.spec.ts`

The allow-list is configured via the `allowedFiles` option in
`eslint.config.mjs` — update there, not here.

#### Fallback: grep-test

If the ESLint rule can't be wired into your editor / CI run, there's
also a standalone Vitest guard at
`apps/api/src/__tests__/no-direct-email-service.test.ts` that greps
the repo for the same pattern. Both belt-and-suspenders: the ESLint
rule gives editor-time feedback, the Vitest test locks CI.
