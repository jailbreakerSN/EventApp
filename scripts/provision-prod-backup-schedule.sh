#!/usr/bin/env bash
# Wave 10 / W10-P5 — provision the daily Firestore backup Cloud Scheduler
# job for PRODUCTION ONLY.
#
# Why a script and not a workflow step: this script is invoked from
# `deploy-production.yml` once per release, but it's also runnable
# stand-alone (e.g. by the operator on call after a manual rollback).
# Idempotent — re-running upserts the existing job.
#
# Environment / activation policy
# ───────────────────────────────
#   - STAGING:    NEVER call this script. Backups are operator-
#     triggered via `POST /v1/admin/jobs/run { name: "firestore-backup" }`.
#     This keeps staging cost low and avoids accidental cross-tenant
#     export confusion when the project hosts multiple test orgs.
#   - PRODUCTION: called from the production deploy workflow on every
#     release. Idempotent — second-and-subsequent runs no-op the
#     scheduler job and only refresh the bound service-account /
#     target URL.
#
# Required env (passed by the deploy workflow):
#   GCP_PROJECT          - "teranga-events-prod"
#   API_BASE_URL         - "https://api.teranga.events"
#   SCHEDULER_SA_EMAIL   - service account that signs the OIDC token
#                          on the scheduler call. Must hold
#                          roles/run.invoker on the API service.
#   SCHEDULE_CRON        - default "0 2 * * *" (02:00 Africa/Dakar = 02:00 UTC)
#   SCHEDULE_TIMEZONE    - default "Africa/Dakar"
#   JOB_NAME             - default "daily-firestore-backup"
#
# Manual override / disable: set DISABLE_BACKUP_SCHEDULE=true in the
# deploy workflow inputs to skip the upsert. This is the
# user-requested "implement but don't activate" toggle: when the env
# var is true, the script logs the intent and exits 0. The job
# itself, if previously provisioned, stays as-is.

set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:?GCP_PROJECT must be set}"
API_BASE_URL="${API_BASE_URL:?API_BASE_URL must be set}"
SCHEDULER_SA_EMAIL="${SCHEDULER_SA_EMAIL:?SCHEDULER_SA_EMAIL must be set}"
SCHEDULE_CRON="${SCHEDULE_CRON:-0 2 * * *}"
SCHEDULE_TIMEZONE="${SCHEDULE_TIMEZONE:-Africa/Dakar}"
JOB_NAME="${JOB_NAME:-daily-firestore-backup}"
LOCATION="${LOCATION:-europe-west1}"

if [[ "${DISABLE_BACKUP_SCHEDULE:-false}" == "true" ]]; then
  echo "DISABLE_BACKUP_SCHEDULE=true — skipping Cloud Scheduler upsert."
  echo "Backup is implemented (apps/api/src/jobs/handlers/firestore-backup.ts)"
  echo "and remains operator-triggerable via POST /v1/admin/jobs/run"
  echo "{ name: \"firestore-backup\" }."
  exit 0
fi

target_url="${API_BASE_URL}/v1/admin/jobs/run"
body='{"name":"firestore-backup","args":{}}'

echo "Upserting Cloud Scheduler job: ${JOB_NAME}"
echo "  Target: ${target_url}"
echo "  Schedule: ${SCHEDULE_CRON} (${SCHEDULE_TIMEZONE})"
echo "  Service account: ${SCHEDULER_SA_EMAIL}"

# Idempotent upsert: try `update`, fall back to `create` on first run.
if gcloud scheduler jobs describe "${JOB_NAME}" \
  --project="${GCP_PROJECT}" \
  --location="${LOCATION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${JOB_NAME}" \
    --project="${GCP_PROJECT}" \
    --location="${LOCATION}" \
    --schedule="${SCHEDULE_CRON}" \
    --time-zone="${SCHEDULE_TIMEZONE}" \
    --uri="${target_url}" \
    --http-method=POST \
    --message-body="${body}" \
    --headers="Content-Type=application/json" \
    --oidc-service-account-email="${SCHEDULER_SA_EMAIL}" \
    --oidc-token-audience="${API_BASE_URL}" \
    --description="Wave 10 P5 — daily Firestore backup. Idempotent. Triggered via /admin/jobs/run." \
    --quiet
  echo "  ↳ updated existing job"
else
  gcloud scheduler jobs create http "${JOB_NAME}" \
    --project="${GCP_PROJECT}" \
    --location="${LOCATION}" \
    --schedule="${SCHEDULE_CRON}" \
    --time-zone="${SCHEDULE_TIMEZONE}" \
    --uri="${target_url}" \
    --http-method=POST \
    --message-body="${body}" \
    --headers="Content-Type=application/json" \
    --oidc-service-account-email="${SCHEDULER_SA_EMAIL}" \
    --oidc-token-audience="${API_BASE_URL}" \
    --description="Wave 10 P5 — daily Firestore backup. Idempotent. Triggered via /admin/jobs/run." \
    --quiet
  echo "  ↳ created new job"
fi

echo "Done. Verify with: gcloud scheduler jobs describe ${JOB_NAME} --location=${LOCATION}"
