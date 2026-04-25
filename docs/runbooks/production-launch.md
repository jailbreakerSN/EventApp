# Runbook — Production launch checklist

_Sprint-3 T4.4 closure. Wave 10 prep._

This is the pre-flight checklist for switching the Cloud Run service
from `staging` to `prod` (or for any release that flips a major
risk surface). Every checkbox must be verifiable; the runbook
references the command or screen that produces the proof.

## 0. Freeze code

- [ ] Develop branch frozen — no merges to `develop` until launch
      complete. Announce in `#engineering` 24 h before.
- [ ] Tag the release: `git tag v0.X.0 -m "..."` + `git push --tags`.
- [ ] Cut a release branch: `git checkout -b release/v0.X.0`.

## 1. Security baseline

- [ ] **Firestore rules deployed.**
      `firebase deploy --only firestore:rules --project prod`.
      Verify via `firebase firestore:rules get`.
- [ ] **Storage rules deployed.** Same, `--only storage`.
- [ ] **All secrets in GCP Secret Manager.** No `.env` files on
      Cloud Run. Verify: `gcloud run services describe teranga-api`
      shows `--set-env-vars` referring to secrets via
      `--update-secrets`, never raw values.
- [ ] **API key auth kill-switch tested.**
      Set `API_KEY_AUTH_DISABLED=true` on a staging Cloud Run
      revision, hit the `terk_*` auth path, confirm 401. Reset
      to `false`.
- [ ] **CORS allowlist correct.** No wildcards in production.
      Verify the `CORS_ORIGINS` env var matches the prod web
      domain set.
- [ ] **Rate limits on.** Spot-check 3 mutating endpoints
      (registration:create, payment:initiate, admin:impersonate).
      `for i in $(seq 1 100); do curl ...; done` and confirm 429s
      after the configured threshold.
- [ ] **HSTS enabled.** `curl -I https://api.teranga.events` shows
      `Strict-Transport-Security: max-age=15552000; includeSubDomains`.
- [ ] **QR_SECRET length ≥ 32 chars.** `gcloud secrets versions access`.

## 2. Observability

- [ ] **SOC alerts wired.** `SOC_ALERT_WEBHOOK_URL` set to the
      production Slack/PagerDuty webhook. Trigger `user.role_changed`
      manually (impersonate-test admin), confirm an alert lands.
- [ ] **Sentry DSN set.** `SENTRY_DSN` populated. Throw a test
      error from `/admin/jobs` (`firestore-backup` with bad
      bucket) and confirm it lands in Sentry.
- [ ] **Lighthouse CI green on the release commit.**
      `gh run list --workflow=lighthouse-ci.yml --limit 1` shows
      success.
- [ ] **Firestore index audit clean.**
      `npx tsx scripts/audit-firestore-indexes.ts` exits 0.
- [ ] **Test suite green.** `cd apps/api && npx vitest run` →
      all green. Cap at the version we tagged.
- [ ] **`/health` and `/ready` reachable** from the load balancer:
      `curl https://api.teranga.events/health` returns 200.

## 3. Disaster recovery

- [ ] **Backup bucket provisioned.** `gsutil ls gs://teranga-backups-prod`
      returns 0 (or non-zero with old backups). See
      `backup-restore.md` step 1.
- [ ] **Backup smoke-test successful.** Trigger `firestore-backup`
      with `label=launch-smoke-test`, wait for completion, verify
      `gsutil ls`.
- [ ] **Restore smoke-test successful.** On a CLONE project, run
      `firestore-restore` from yesterday's backup. Validate with
      `scripts/seed-coverage-scan.ts`.
- [ ] **Daily backup cron live.** Cloud Scheduler job
      `daily-firestore-backup` exists and runs at 02:00
      Africa/Dakar.

## 4. Performance

- [ ] **Load test passed.** `k6 run scripts/load-tests/admin.js`
      against staging — p95 < 500 ms, p99 < 1 s on every endpoint
      under 50 concurrent admins.
- [ ] **Cold-start budget < 2 s.** Cloud Run min-instances ≥ 1
      OR cold-start measured at < 2 s.
- [ ] **Cost dashboard reviewed.** `/admin/cost` over the last 7
      days — top consumer < 100k reads/day. Anything spiking gets
      a query-plan review.

## 5. Compliance

- [ ] **CGU + Privacy Policy live** on the participant + back-office
      domains.
- [ ] **Email templates branded** — Resend domain verified, SPF +
      DKIM + DMARC pass `mxtoolbox`.
- [ ] **Audit log retention** ≥ 12 months (verify the
      `auditLogs` TTL in `infrastructure/firebase/firestore.ttl.md`).
- [ ] **Data export endpoint smoke-tested.** A user export returns
      their data for a registered participant.

## 6. Operational on-call

- [ ] **PagerDuty rotation set.** Two-person primary +
      secondary. Document handover in
      `docs/runbooks/on-call-rotation.md`.
- [ ] **`#prod-incidents` Slack channel created** with PagerDuty
      integration.
- [ ] **Runbook index** — every runbook in `docs/runbooks/` is
      reachable from the on-call doc.
- [ ] **Customer-success has read access** to `/admin/audit` +
      `/admin/inbox` via a `platform:support` role assignment.

## 7. Communication

- [ ] **Release notes drafted** — features, fixes, known issues.
- [ ] **Status page** — uptime tracker (Atlassian / BetterUptime) live.
- [ ] **Customer-facing announcement** — in-app banner via
      `/admin/settings/announcements`, scheduled for go-live time.
- [ ] **Emergency contact list** — devs + infra + GCP support
      number. Pinned in `#engineering`.

## 8. Go / no-go

Final review meeting (T-4 h) walks through this checklist with
DRI sign-offs. Any unchecked item = no-go OR documented exception
with a mitigation owner.

## Rollback plan

If the launch goes south within the first hour:

1. Revert Cloud Run to the previous revision:
   `gcloud run services update-traffic teranga-api --to-revisions=<prev-revision>=100`.
2. Notify customers via the in-app banner.
3. Schedule a post-mortem within 48 h.

If the launch survives the first hour but a corruption shows up:

1. Trigger `firestore-restore` from the last known-good backup
   (see `backup-restore.md`).
2. Same comms + post-mortem as above.

## Related

- `backup-restore.md` — Firestore export/import procedure
- `docs/admin-overhaul/FIDELITY-AUDIT.md` — what's been built
- `CLAUDE.md` § Security Hardening Checklist — the per-PR guard
