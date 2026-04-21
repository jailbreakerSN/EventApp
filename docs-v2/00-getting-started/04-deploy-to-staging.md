# Deploy to Staging

> **Status: shipped** — The staging pipeline deploys to GCP Cloud Run + Firebase (europe-west1). No production deploy pipeline exists yet.

---

## Overview

Merging to `develop` automatically triggers `deploy-staging.yml`:

```
develop branch merge
  └─► CI gate (must pass)
        └─► deploy-staging.yml
              ├── Build Docker image → Artifact Registry
              ├── Deploy API → Cloud Run (staging)
              ├── Deploy web-backoffice → Cloud Run (staging)
              ├── Deploy web-participant → Cloud Run (staging)
              ├── Deploy Firebase rules + indexes + storage + functions
              ├── Run seed-staging (idempotent)
              ├── Run QA fixtures
              ├── Run balance-ledger backfill
              └── Smoke test (5-retry, cold-start tolerant)
```

All resources deploy to the `teranga-app-990a8` Firebase project in `europe-west1`.

---

## Manual staging deploy (when needed)

### Prerequisites

```bash
# Authenticate to GCP
gcloud auth login
gcloud config set project teranga-app-990a8

# Authenticate Firebase CLI
firebase login
firebase use staging   # alias: teranga-app-990a8
```

### API — Cloud Run

```bash
# Build image
docker build -f apps/api/Dockerfile \
  -t europe-west1-docker.pkg.dev/teranga-app-990a8/teranga/api:latest \
  .

# Push
docker push europe-west1-docker.pkg.dev/teranga-app-990a8/teranga/api:latest

# Deploy
gcloud run deploy teranga-api \
  --image europe-west1-docker.pkg.dev/teranga-app-990a8/teranga/api:latest \
  --region europe-west1 \
  --cpu 1 \
  --memory 512Mi \
  --max-instances 2 \
  --allow-unauthenticated \
  --set-env-vars="FIREBASE_PROJECT_ID=teranga-app-990a8,USE_EMULATOR=false,..."
```

> Env vars for Cloud Run are injected via `--set-env-vars` or Secret Manager. See [Secrets & env vars](../50-operations/secrets-and-env.md).

### Firebase (rules, functions, hosting)

```bash
# Deploy everything
firebase deploy

# Or selectively
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage
firebase deploy --only functions
firebase deploy --only hosting:web-backoffice
firebase deploy --only hosting:web-participant
```

---

## Seeding staging

The seed script has a safety guard that skips the bulk seed if organizations already exist in staging. It always re-runs plan catalog upserts and `effectiveLimits` backfill:

```bash
npm run seed:staging
# or
npx tsx scripts/seed-emulators.ts --env=staging
```

---

## Smoke tests

The `deploy-staging.yml` workflow runs smoke tests against the deployed API:

```bash
# Manually run smoke tests
npx tsx scripts/smoke-test.ts --api-url=https://teranga-api-<hash>-ew.a.run.app
```

The smoke test calls:
- `GET /health` → must return 200
- `GET /ready` → must return 200 (Firestore + Auth connectivity)
- `GET /v1/events` → must return list of events
- `POST /v1/auth/verify` → must validate a test token

The test retries each call up to 5 times with 10-second intervals to handle Cloud Run cold starts.

---

## Artifact Registry cleanup

Artifact Registry stores Docker images. To avoid storage costs, a manual workflow deletes images older than the last 3 versions:

**Actions → Artifact Registry Cleanup → Run workflow**

This is manual by design — never triggered automatically.

---

## Checking the deployment

After deploying, verify:

1. **API health:** `curl https://<run-url>/health` → `{"status":"ok"}`
2. **Readiness:** `curl https://<run-url>/ready` → `{"status":"ready","firestore":true,"auth":true}`
3. **Firebase Console:** Firestore rules last-deployed timestamp
4. **Cloud Run:** Console → Cloud Run → teranga-api → Revisions (latest serving 100% traffic)

---

## Production deploy

> **⚠ planned** — No production deploy pipeline exists yet. The `main` branch and `teranga-events-prod` Firebase project are reserved for the Wave 10 production launch.

When ready, production will follow the same pattern as staging but with:
- `firebase use production` (project: `teranga-events-prod`)
- Separate Cloud Run service (`teranga-api-prod`)
- GCP Secret Manager for all secrets (no `--set-env-vars`)
- Manual approval gate before `gcloud run deploy`
