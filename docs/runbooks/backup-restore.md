# Runbook — Firestore backup & restore

_Last updated: Sprint-3 T4.3 closure._

## TL;DR

| What you need | How to do it |
|---|---|
| **Trigger a backup now** | `/admin/jobs` → run `firestore-backup` |
| **List past backups** | `gsutil ls gs://<bucket>/` |
| **Trigger a restore** | `/admin/jobs` → run `firestore-restore` with the export prefix |
| **Cancel an in-flight operation** | `gcloud firestore operations cancel <op-id>` |

## Prerequisites (one-time setup)

These steps are mandatory before the `firestore-backup` and
`firestore-restore` admin jobs will succeed. Anyone deploying to a
new environment runs through this checklist once.

1. **Create a dedicated GCS bucket.**
   ```bash
   gsutil mb -l europe-west1 -c STANDARD gs://teranga-backups-prod
   gsutil versioning set on gs://teranga-backups-prod
   gsutil lifecycle set docs/runbooks/backup-bucket-lifecycle.json gs://teranga-backups-prod
   ```
   The lifecycle rule (90-day retention) is committed to keep storage
   costs bounded — exports older than 90 days are automatically
   purged.

2. **Grant the Cloud Run service account the right roles** on the
   project AND on the bucket:
   ```bash
   PROJECT=teranga-events-prod
   SA=teranga-api@${PROJECT}.iam.gserviceaccount.com

   # Project-level: read/write Firestore exports
   gcloud projects add-iam-policy-binding ${PROJECT} \
     --member="serviceAccount:${SA}" \
     --role="roles/datastore.importExportAdmin"

   # Bucket-level: write to the export bucket
   gsutil iam ch serviceAccount:${SA}:roles/storage.admin \
     gs://teranga-backups-prod
   ```

3. **Set the env var on Cloud Run.**
   ```bash
   gcloud run services update teranga-api \
     --update-env-vars FIRESTORE_BACKUP_BUCKET=gs://teranga-backups-prod \
     --region europe-west1
   ```
   Without this the job exits early with a clear error
   ("FIRESTORE_BACKUP_BUCKET unset"), so partially-configured
   environments fail loud rather than silent.

4. **Verify with a smoke-test backup.** Trigger `firestore-backup`
   from `/admin/jobs` with `label=smoke-test` and
   `collectionIds=plans` (a tiny collection). Watch the run log;
   confirm `gsutil ls gs://teranga-backups-prod/` shows the new
   prefix within ~30 s.

## Triggering a backup

### Routine pre-mutation backup

Before any destructive admin operation (plan migration, mass
updates, schema changes), trigger an opt-in backup of the touched
collections:

1. Navigate to `/admin/jobs`.
2. Find `firestore-backup`. Click "Run".
3. In the input JSON, supply:
   - `collectionIds`: comma-separated list, e.g. `"organizations,users"`.
     Empty = back up everything (heavier and slower).
   - `label`: free-form tag like `"pre-Q2-plan-migration"` so
     `gsutil ls` lists the run with intent visible.
4. The job returns the long-running operation id. Copy it.
5. Track progress: `gcloud firestore operations describe <op-id> --project teranga-events-prod`.
   Typical completion times:
   - Single small collection (~plans, ~10 docs): 30 s
   - Full database (~10k docs): 3-5 min

### Scheduled daily backup

Automated via Cloud Scheduler — see `infrastructure/terraform/`
(future). Until that lands, the manual job is the source of truth.

## Triggering a restore

**Restore is destructive.** Documents in the live database that
share an id with documents in the export are overwritten. Run
through this checklist before clicking "Run":

1. **Confirm the export prefix.** `gsutil ls gs://<bucket>/` and
   pick the right one. Copy the full path: `gs://teranga-backups-prod/2026-04-25T10-00-00-000Z--pre-migration`.

2. **Test on a clone first** if the export is older than 1 hour.
   Provision a new Firestore database in a separate project, point
   the API at it, run the restore there, validate. This protects
   against importing an export that has missing documents (e.g. a
   doc was created after the export but before the restore — a
   restore would erase it without trace).

3. **Notify SOC.** Drop a message in the `#prod-changes` Slack
   channel: who, what, when, expected duration, rollback plan.

4. Trigger from `/admin/jobs`:
   - `inputUriPrefix`: the GCS path from step 1
   - `collectionIds`: optional whitelist, recommended in production
     to scope the import to the smallest set that solves the
     incident

5. Track the long-running operation:
   `gcloud firestore operations describe <op-id>`.

6. **Verify post-restore.** Run smoke-test fixtures
   (`scripts/seed-coverage-scan.ts` covers most invariants), open
   `/admin/inbox` to confirm no new alerts, manually exercise one
   flow per role (organizer login, participant register, admin
   audit search).

## Failure modes

### `FAILED_PRECONDITION: only one operation` 

Firestore enforces one concurrent export OR import per database. If
an in-flight operation is stuck, list it via
`gcloud firestore operations list` and either wait or cancel it.

### `PERMISSION_DENIED`

Service account lacks `roles/datastore.importExportAdmin` (project)
or `roles/storage.admin` (bucket). Re-run step 2 of the prereqs.

### `INVALID_ARGUMENT: collectionIds`

The collection ids in the import don't exist in the export. List
the export's collections via:
```bash
gsutil cat gs://<bucket>/<prefix>/all_namespaces/all_kinds/output-0
```
The metadata is binary protobuf but the prefix listing
(`gsutil ls -r`) shows one folder per collection.

### Job times out (5-minute hard cap)

Backup/restore are LRO (long-running operations) — the API call
returns in ~1 s with the operation id, then GCP completes
asynchronously. The 5-minute job timeout is for the API call only,
not the underlying export. Always check `gcloud operations describe`
to see the real completion state.

## Disaster recovery — from zero

If the live database is corrupted and you need to restore TODAY:

1. Find the most recent good backup (`gsutil ls`).
2. **Notify SOC + customers** — restoration is destructive;
   anything written between the backup and now will be lost.
3. Disable writes by flipping the `MAINTENANCE_MODE=true` flag
   on Cloud Run (the API serves a 503 to mutating routes).
4. Trigger `firestore-restore`. Wait for completion.
5. Run `seed-coverage-scan.ts` to validate.
6. Re-enable writes.
7. Post-mortem writeup in `docs/incidents/`.

RPO target: 24 h (daily backups).
RTO target: 1 h (smoke-tested restore time).

## Related

- `apps/api/src/jobs/handlers/firestore-backup.ts` — implementation
- `apps/api/src/jobs/handlers/firestore-restore.ts` — implementation
- `docs/runbooks/production-launch.md` — pre-launch checklist
