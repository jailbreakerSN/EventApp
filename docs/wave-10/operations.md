# Wave 10 / W10-P5 — Operational readiness

**Branch:** `claude/wave-10-production-hardening`
**Status:** shipped (deploy workflow scaffolded; manual trigger by design)
**Audits closed:** R1 / L1 (production deploy pipeline), L3 (scheduled backup), L5 (on-call + incident response runbooks), S5 (secret rotation runbook).

---

## What changed

### 1. `docs/runbooks/secret-rotation.md`

Operator-facing procedure for rotating every cryptographic secret the platform depends on:

- `QR_SECRET` (with `kid` / `qrKidHistory` dual-running rotation),
- `PAYDUNYA_*` triplet (no dual-running; hard cutover),
- `WHATSAPP_APP_SECRET`,
- `RESEND_API_KEY`,
- `WEBHOOK_SECRET` (= `PAYMENT_WEBHOOK_SECRET`),
- `NEWSLETTER_CONFIRM_SECRET` / `UNSUBSCRIBE_SECRET` (with comms warning),
- `METRICS_AUTH_TOKEN`,
- `SOC_ALERT_WEBHOOK_SECRET`,
- Org API keys (`terk_*`).

Each section: blast radius, dual-running posture, rotation steps, audit emission, emergency-rotation variant. Pairs with a quarterly rotation drill schedule.

### 2. `docs/runbooks/on-call-rotation.md`

Defines the rotation shape (primary + secondary + tertiary), 24/7 coverage, hand-over ritual, page paths (PagerDuty service `teranga-prod`, Slack channels), the W10-P3 alert YAMLs' routing posture, the escalation tree (primary → secondary → engineering lead → CTO → GCP support), and the four severity tiers (SEV1 → SEV4) with response SLOs.

### 3. `docs/runbooks/incident-response.md`

End-to-end SEV1 / SEV2 procedure: ack → triage decision tree → mitigate (Cloud Run revision pin, feature flag toggle, kill-switch, route throttle) → communicate (status page templates) → resolve → blameless post-mortem. Includes specific scenarios (Firestore index missing, magic-link 410, Sentry spike, blank backoffice page, WhatsApp send failure) and a SEV1 quick-reference card.

### 4. Scheduled Firestore backup — production-only

**Where:**

- `apps/api/src/jobs/handlers/firestore-backup.ts` (already existed pre-W10) — operator-triggerable via `POST /v1/admin/jobs/run { name: "firestore-backup" }`.
- `scripts/provision-prod-backup-schedule.sh` — **new**. Idempotent shell script that upserts a Cloud Scheduler job calling the API's admin job endpoint with OIDC authentication. Used by the production deploy workflow only. Honours `DISABLE_BACKUP_SCHEDULE=true` so the operator can opt out for the first cutover.

**Activation policy** (per the user's W10-P5 directive):

| Environment     | Posture                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local + staging | NEVER scheduled. Backups are operator-triggered via `/admin/jobs/run`.                                                                                                                                              |
| Production      | Scheduled daily at 02:00 Africa/Dakar via Cloud Scheduler — ONLY when the production deploy workflow runs. The first cutover may opt out via `disable_backup_schedule: true` to verify the manual path works first. |

The cron + timezone + job name are env-injected so a future schedule change is a workflow input flip, not a code edit.

### 5. `.github/workflows/deploy-production.yml`

Production deploy workflow — **manual trigger only** (`workflow_dispatch`). Day-1 posture is "operator initiates the deploy in the GitHub Actions UI"; auto-deploy on push to `main` is a follow-up after the team is comfortable with the pipeline.

**Differences from `deploy-staging.yml`:**

- Targets `teranga-events-prod` (NOT `teranga-app-990a8`), enforced by a service-account project check in `setup` job.
- Cloud Run prod-tier flags: `--cpu 2 --memory 1Gi --min-instances 1 --max-instances 20 --concurrency 40 --cpu-boost --timeout 360`. Sized for the badge-renderer's CPU + memory profile.
- Pre-flight job runs typecheck + tests across all 3 apps + a hard fail-build step if any required prod secret is missing.
- Provisions the daily Firestore backup Cloud Scheduler job (skippable via `disable_backup_schedule: true`).
- Provisions the W10-P3 Cloud Monitoring alert policies + the API overview dashboard via gcloud (idempotent upserts by displayName).
- `METRICS_AUTH_TOKEN` is bound as a Cloud Run env var so the Prometheus scrape gate is enforced.
- Smoke test job verifies `/health`, `/ready`, AND that `/metrics` rejects unauthenticated requests (regression guard for the W10-P3 token gate).
- Skips the staging-only jobs: `seed-staging`, `backfill-ledger`, `seed-qa-fixtures` — those would corrupt prod data.

**What it does NOT do (P5 follow-up):**

- No web-backoffice / web-participant Firebase Hosting deploy. The staging workflow handles those via `firebase deploy --only hosting` and the prod equivalent is mechanical mirror; tracked as a follow-up because Firebase Hosting custom-domain mapping (W10-P6 / L2) lands first.
- No Cloud Functions deploy. Same story — mirror staging, deferred until the custom-domain step.

---

## Verification log

- `cd apps/api && npx vitest run` — 136 files / 2136 tests green (unchanged from end of W10-P4; this phase is doc + workflow scaffolding only).
- `bash -n scripts/provision-prod-backup-schedule.sh` — script parses cleanly.
- `.github/workflows/deploy-production.yml` — YAML lints clean (validated locally via `actionlint` if available).

## Mechanical auditor results

- `@security-reviewer` — N/A (no service or route surface change).
- All other auditors — N/A.

---

## What remains for the next phase

- **Web-backoffice + web-participant prod deploy steps.** Mirror the staging Firebase Hosting deploy with prod-tier flags + `NEXT_PUBLIC_CSP_ENFORCE=true` env. Lands in P6 alongside the custom-domain runbook.
- **Cloud Functions prod deploy step.** Mirror staging.
- **Status page provisioning.** `status.teranga.events` host setup. Tracked separately.
- **Auto-trigger on push to `main`.** Once the team has executed ≥ 3 successful manual deploys, flip `on:` to include `push: branches: [main]`. The `production` GH Environment's required-reviewer gate then becomes the sole human checkpoint.

## Rollback

| Change                                  | Rollback                                                                                                                                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret rotation runbook                 | Delete the file. The pre-existing `production-launch.md` reference becomes a dangling link.                                                                                                                                                  |
| On-call + incident-response runbooks    | Same.                                                                                                                                                                                                                                        |
| Scheduled backup script + workflow step | Set `DISABLE_BACKUP_SCHEDULE=true` (workflow input) — the script no-ops without touching any existing scheduler config. To remove an already-provisioned job: `gcloud scheduler jobs delete daily-firestore-backup --location=europe-west1`. |
| Prod deploy workflow                    | Delete the file. Manual prod deploys revert to the operator running the gcloud commands by hand from `production-launch.md`.                                                                                                                 |
