---
title: Secrets & Environment Variables
status: shipped
last_updated: 2026-04-25
---

# Secrets & Environment Variables

> **Status: shipped** — All variables documented below are required for a running system.

**Rule: Never commit `.env`, service account JSON files, or Firebase API keys to git.** Copy `.env.example` files and fill in real values locally.

---

## API (`apps/api/.env`)

| Variable | Required | Description | Example |
|---|---|---|---|
| `FIREBASE_PROJECT_ID` | ✅ | Firebase project ID | `teranga-app-990a8` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | ⚠ staging/prod | Path to service account JSON, or inline JSON. Leave empty for emulator (uses ADC) | `/secrets/sa.json` |
| `QR_SECRET` | ✅ | Legacy QR signing secret (v1/v2/v3). Min 16 chars. | `<openssl rand -hex 32>` |
| `QR_MASTER_SECRET` | ✅ | QR v4 HKDF master secret. Min 32 chars. | `<openssl rand -hex 32>` |
| `USE_EMULATOR` | local only | `true` = connect to Firebase emulators | `true` |
| `CORS_ORIGINS` | ✅ | Comma-separated allowed origins | `http://localhost:3001,http://localhost:3002` |
| `LOG_LEVEL` | optional | Pino log level | `info` |
| `PORT` | optional | API port (default: 3000) | `3000` |
| `RESEND_API_KEY` | ⚠ staging/prod | Resend transactional email API key | `re_...` |
| `RESEND_FROM_EMAIL` | ⚠ staging/prod | From address for emails | `noreply@teranga.events` |
| `AT_API_KEY` | ⚠ staging/prod | Africa's Talking SMS API key | `atsk_...` |
| `AT_USERNAME` | ⚠ staging/prod | Africa's Talking username | `teranga_prod` |
| `AT_SENDER_ID` | optional | SMS sender ID for Senegal | `TERANGA` |
| `WAVE_API_KEY` | ⚠ staging/prod | Wave payment provider API key | `wv_...` |
| `WAVE_MERCHANT_ID` | ⚠ staging/prod | Wave merchant ID | |
| `ORANGE_MONEY_CLIENT_ID` | ⚠ staging/prod | Orange Money OAuth2 client ID | |
| `ORANGE_MONEY_CLIENT_SECRET` | ⚠ staging/prod | Orange Money OAuth2 secret | |
| `SENTRY_DSN` | optional | Sentry error tracking DSN | `https://...@sentry.io/...` |
| `APP_ENV` | optional | `development` / `staging` / `production` | `staging` |

---

## Web back-office (`apps/web-backoffice/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | ✅ | Firebase web SDK API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | ✅ | Firebase Auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | ✅ | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | ✅ | Cloud Storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | ✅ | FCM sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | ✅ | Firebase app ID |
| `NEXT_PUBLIC_API_URL` | ✅ | Fastify API base URL |
| `NEXT_PUBLIC_USE_EMULATOR` | local only | `true` = connect to emulators |

---

## Web participant app (`apps/web-participant/.env.local`)

Same Firebase web SDK variables as back-office, plus `NEXT_PUBLIC_API_URL`.

---

## Cloud Functions (`apps/functions`)

Functions run in the Firebase environment. Secrets are set via:

```bash
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set QR_MASTER_SECRET
```

Or for non-secret config:

```bash
firebase functions:config:set email.from="noreply@teranga.events"
```

---

## Getting Firebase web SDK config

1. Go to [Firebase Console](https://console.firebase.google.com) → Project settings → Your apps → Web app
2. Copy the `firebaseConfig` object
3. Map keys to the `NEXT_PUBLIC_FIREBASE_*` variables above

---

## Getting a service account key (staging/prod)

```bash
gcloud iam service-accounts create teranga-api \
  --display-name="Teranga API Service Account"

gcloud projects add-iam-policy-binding teranga-app-990a8 \
  --member="serviceAccount:teranga-api@teranga-app-990a8.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud iam service-accounts keys create apps/api/service-account.json \
  --iam-account=teranga-api@teranga-app-990a8.iam.gserviceaccount.com
```

**Never commit `service-account.json`.** It is in `.gitignore`.

On Cloud Run, use Workload Identity Federation instead of a key file — the deploy workflow is already configured for this.

---

## Rotating QR_MASTER_SECRET

Rotating `QR_MASTER_SECRET` invalidates **all** previously issued v4 QR codes. Procedure:

1. Announce the rotation window (typically after a large event season ends)
2. Update the secret in Secret Manager and Cloud Run env
3. For each event, rotate the event's `qrKid` via `POST /v1/events/:id/qr-key/rotate`
4. Regenerate all badges (the old QRs will fail, new ones will use the new derived key)

For a less disruptive rotation, use per-event `qrKid` rotation instead — new badges get the new key, old badges continue to work until they expire.

---

## CI secrets (GitHub repository secrets)

| Secret name | Used in |
|---|---|
| `GCP_SERVICE_ACCOUNT_KEY` | deploy-staging.yml — Cloud Run deploy |
| `FIREBASE_SERVICE_ACCOUNT` | deploy-staging.yml — Firebase deploy |
| `RESEND_API_KEY` | deploy-staging.yml — passed to Cloud Run |
| `QR_SECRET` | deploy-staging.yml |
| `QR_MASTER_SECRET` | deploy-staging.yml |
| `WAVE_API_KEY` | deploy-staging.yml |
| `ORANGE_MONEY_CLIENT_ID` | deploy-staging.yml |
| `ORANGE_MONEY_CLIENT_SECRET` | deploy-staging.yml |
| `SENTRY_DSN` | deploy-staging.yml |
