# Teranga Staging QA — Playwright Runbook

Operational guide for the automated browser QA suite introduced with the P1 UX/UI ship (2026-04-14).

**Code:** [`scripts/staging-qa/`](../../scripts/staging-qa/)
**CI:** [`.github/workflows/staging-qa.yml`](../../.github/workflows/staging-qa.yml)
**Manual checklist it complements:** PR #37 / the `Manual QA Checklist` posted in the session thread.

---

## 1. When to run it

| Trigger | Workflow | Purpose |
| --- | --- | --- |
| Auto — after every successful `Deploy Staging` run | `staging-qa.yml` `workflow_run` | Regression sweep on each new staging build |
| Manual — Actions tab → "Staging QA (Playwright)" → Run workflow | `workflow_dispatch` | Ad-hoc pass after manual infra changes |
| Local — `cd scripts/staging-qa && npx playwright test` | any dev machine | Debug a failing test, codegen new selectors |

## 2. Local setup (one-time)

```bash
cd scripts/staging-qa
npm install --no-audit --no-fund
npx playwright install --with-deps chromium
```

The `--with-deps` flag installs the system libraries Chromium needs. On fresh containers without `sudo`, drop it and install them separately.

## 3. Running

### Full suite against the default staging URLs

```bash
cd scripts/staging-qa
npx playwright test
```

### Override target URLs

```bash
STAGING_BACKOFFICE=https://teranga-backoffice-preview-xyz.run.app \
STAGING_PARTICIPANT=https://teranga-participant-preview-xyz.run.app \
  npx playwright test
```

### Run a single spec

```bash
npx playwright test tests/smoke.spec.ts
npx playwright test tests/discovery.spec.ts --project=chromium-mobile
```

### Debug a failure interactively

```bash
PWDEBUG=1 npx playwright test tests/event-detail.spec.ts
```

### Codegen a new selector against staging

```bash
STAGING_BACKOFFICE=… npx playwright codegen $STAGING_BACKOFFICE
```

### Open the HTML report

```bash
npx playwright show-report
```

## 4. Fixtures — enabling authenticated-flow tests

Today the suite covers public surfaces only. To unlock the dashboard / verify-email / organiser flows:

1. **Seed a test participant and a test organiser** in the staging Firebase project.
   ```bash
   cd apps/api
   FIREBASE_PROJECT=teranga-events-staging \
   npx tsx scripts/seed-emulators.ts --target staging
   ```

2. **Create a `buildIdToken` helper** at `scripts/staging-qa/fixtures/firebase-token.ts` that signs into the seeded user via the Firebase Auth REST API and returns a fresh ID token. Store the seeded user's email + password as GitHub Actions secrets (`STAGING_VERIFIED_EMAIL`, `STAGING_VERIFIED_PASSWORD`, `STAGING_UNVERIFIED_EMAIL`, `STAGING_UNVERIFIED_PASSWORD`).

3. **Add a Playwright `test.use()` block** that sets `extraHTTPHeaders: { authorization: 'Bearer <token>' }` before each test. Next.js reads the header and the Fastify API trusts it.

This unlocks specs for:
- Dashboard render + H6 email-verification hard gate
- Organiser event creation + H4 DataTable edits
- Payment flow + webhook receipts
- Feed / messaging / checkin authenticated surfaces

## 5. CI — reading results

Every run uploads two artefacts:

- **`playwright-report-<run-id>.zip`** — always. Open `index.html` locally or:
  ```bash
  unzip playwright-report-XYZ.zip -d report
  npx playwright show-report report
  ```
- **`test-results-<run-id>.zip`** — only on failure. Contains traces you can open with:
  ```bash
  unzip test-results-XYZ.zip -d results
  npx playwright show-trace results/<test>/trace.zip
  ```

The trace viewer replays the test step-by-step, shows network activity, DOM snapshots, and console logs.

## 6. Required GitHub Actions secrets

| Secret | Required? | Used by |
| --- | --- | --- |
| `STAGING_BACKOFFICE` | Yes — enables the backoffice specs | all specs |
| `STAGING_PARTICIPANT` | Yes — enables the participant specs | all specs |
| `STAGING_API` | Optional | `api-security.spec.ts` |
| `STAGING_UNVERIFIED_ID_TOKEN` | Optional | `api-security.spec.ts` — `EMAIL_NOT_VERIFIED` assertion |

Set them from **Repo Settings → Secrets and variables → Actions → New repository secret**.

If a required secret is missing, the affected spec skips with a clear message rather than false-failing.

## 7. Triage — what to do when CI fails

1. **Download the report artefact** from the Actions run page.
2. **Open `index.html`** — failures are listed first, each with a trace link.
3. **Inspect the trace** — it shows the exact click sequence, network calls, and a before/after DOM snapshot.
4. **Reproduce locally**:
   ```bash
   cd scripts/staging-qa
   STAGING_BACKOFFICE=<same URL as CI> PWDEBUG=1 npx playwright test <failing-spec>
   ```
5. **Decide**:
   - **True regression** — file an issue, link the trace, assign to the relevant Wave 10 engineer.
   - **Flaky test** — retry (CI already retries once). If flaky > 2x in a week, mark the test `.skip` with a TODO pointing to the follow-up.
   - **Staging-config drift** — URL rotated, auth fixtures stale, etc. Fix the env var / fixture and re-run.

## 8. Extending the suite

1. Pick a task from `docs/design-system/execution-plan-2026-04-13.md` §P2.
2. Add a new spec under `scripts/staging-qa/tests/<task>.spec.ts` — follow the existing style (JSDoc header, `test.describe` grouping, `test.use({ baseURL: … })`).
3. Import the shared helpers from `_shared.ts`. Keep per-spec helpers inline if < 10 lines.
4. Run locally, commit, open a PR. The CI will pick up the new file automatically.

## 9. Known limitations

- **No visual diffing** — `responsive.spec.ts` captures screenshots as artefacts but does not pixel-diff. If you need that, wire up Percy or Chromatic next.
- **Authenticated flows are gated on fixtures** — §4 above.
- **Cloud Run cold starts** add 6-10s on the first hit — `actionTimeout` / `navigationTimeout` already account for this.
- **Mobile gestures** — the `chromium-mobile` project uses Playwright's iPhone 13 emulator. Real-device quirks (iOS Safari 100 % height, pull-to-refresh) are not tested.
- **Screen-reader announcements** — axe catches the static structure (roles, labels, contrast) but cannot verify NVDA / VoiceOver output. Manual passes remain the source of truth for AT behaviour.

## 10. Related docs

- [`docs/design-system/audit-2026-04-13.md`](../design-system/audit-2026-04-13.md) — the audit that drove the P1 ship
- [`docs/design-system/p1-closure-2026-04-14.md`](../design-system/p1-closure-2026-04-14.md) — what shipped, what deferred
- [`docs/design-system/implementation-plan-2026-04-13.md`](../design-system/implementation-plan-2026-04-13.md) — branching policy, skills, subagents
- `scripts/design-verification/verify_*.py` — static verifiers that run on every PR (complement to this browser suite)
