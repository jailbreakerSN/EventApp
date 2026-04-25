---
title: Environment Variables Reference
status: shipped
last_updated: 2026-04-25
---

# Environment Variables Reference

> Master reference for all environment variables across every service. Copy `.env.example` files and fill in real values — never commit secrets to git.

---

## Quick Setup

```bash
cp apps/api/.env.example              apps/api/.env
cp apps/web-backoffice/.env.example   apps/web-backoffice/.env.local
cp apps/web-participant/.env.example  apps/web-participant/.env.local
```

---

## API Service (`apps/api`)

Source: `apps/api/.env.example` and validated in `apps/api/src/config/index.ts`.

### Server

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `3000` | No | Fastify listen port |
| `HOST` | `0.0.0.0` | No | Fastify bind address. Use `0.0.0.0` for WSL2 / Docker |
| `NODE_ENV` | `development` | No | `development` \| `staging` \| `production` |
| `LOG_LEVEL` | `info` | No | `silent` \| `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |

### Firebase Admin SDK

| Variable | Default | Required | Description |
|---|---|---|---|
| `FIREBASE_PROJECT_ID` | — | **Yes** | GCP project ID (e.g. `teranga-app-990a8`). Must match regex `^[a-z][a-z0-9-]{4,28}[a-z0-9]$` |
| `FIREBASE_STORAGE_BUCKET` | — | **Yes** | Cloud Storage bucket (e.g. `teranga-app-990a8.appspot.com`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | In production | Path to service account JSON. Not needed with Application Default Credentials on Cloud Run |

### CORS & Rate Limiting

| Variable | Default | Required | Description |
|---|---|---|---|
| `CORS_ORIGINS` | `http://localhost:3001,http://localhost:3002` | No | Comma-separated list of allowed origins |
| `RATE_LIMIT_MAX` | `100` | No | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | No | Rate limit window in milliseconds |

### QR Code Signing

| Variable | Default | Required | Description |
|---|---|---|---|
| `QR_SECRET` | — | **Yes** | HMAC-SHA256 secret for v1–v3 QR signing. Minimum 32 characters. Unique per environment |
| `QR_MASTER` | — | No | Master key for v4 HKDF per-event key derivation. Minimum 32 characters. Must be different from `QR_SECRET` |

**Rotation:** See `docs-v2/50-operations/secrets-and-env.md` for the rotation procedure. Changing `QR_SECRET` invalidates all existing v1–v3 QR codes.

### Webhooks

| Variable | Default | Required | Description |
|---|---|---|---|
| `WEBHOOK_SECRET` | `dev-webhook-secret-change-in-prod` | No | Shared secret for incoming payment webhooks (Wave, Orange Money). Change in production |

### Email (Resend)

| Variable | Default | Required | Description |
|---|---|---|---|
| `RESEND_API_KEY` | — | No (emails silently skipped) | Resend API key. Get from resend.com |
| `RESEND_FROM_EMAIL` | `noreply@teranga.events` | No | Sender email address |
| `RESEND_FROM_NAME` | `Teranga Events` | No | Sender display name |

### SMS (Africa's Talking)

| Variable | Default | Required | Description |
|---|---|---|---|
| `AT_API_KEY` | — | No (SMS silently skipped) | Africa's Talking API key |
| `AT_USERNAME` | `sandbox` | No | `sandbox` for development, account username for production |
| `AT_SENDER_ID` | `Teranga` | No | Sender ID shown on SMS (max 11 alphanumeric chars) |

### Payments — Wave

| Variable | Default | Required | Description |
|---|---|---|---|
| `WAVE_API_KEY` | — | No | Wave API key |
| `WAVE_API_SECRET` | — | No | Wave API secret |
| `WAVE_API_URL` | — | No | Wave API base URL |

### Payments — Orange Money

| Variable | Default | Required | Description |
|---|---|---|---|
| `ORANGE_MONEY_API_URL` | — | No | Orange Money API base URL |
| `ORANGE_MONEY_CLIENT_ID` | — | No | OAuth2 client ID |
| `ORANGE_MONEY_CLIENT_SECRET` | — | No | OAuth2 client secret |
| `ORANGE_MONEY_MERCHANT_KEY` | — | No | Merchant identifier |
| `ORANGE_MONEY_NOTIF_TOKEN` | — | No | Token for validating incoming Orange Money webhook notifications |

### Payments — Card (stub, not yet implemented)

| Variable | Default | Required | Description |
|---|---|---|---|
| `PAYDUNYA_API_KEY` | — | No | PayDunya API key (Senegal card payments) |
| `STRIPE_SECRET_KEY` | — | No | Stripe secret key (international cards fallback) |
| `STRIPE_WEBHOOK_SECRET` | — | No | Stripe webhook signing secret |

### Finance Configuration

| Variable | Default | Required | Description |
|---|---|---|---|
| `PLATFORM_FEE_RATE` | `0.05` | No | Platform fee as a decimal (e.g. `0.05` = 5%). Applied to paid ticket revenue |
| `FUNDS_RELEASE_DAYS` | `7` | No | Days after event end before organizer payout is released |

### URLs

| Variable | Default | Required | Description |
|---|---|---|---|
| `API_BASE_URL` | `http://localhost:3000` | No | Public API URL (used in email links) |
| `PARTICIPANT_WEB_URL` | `http://localhost:3002` | No | Participant web app URL (used in email and badge links) |

### Observability

| Variable | Default | Required | Description |
|---|---|---|---|
| `SENTRY_DSN` | — | No | Sentry DSN for error reporting. Only 5xx errors are reported |

---

## Web Backoffice (`apps/web-backoffice`)

Source: `apps/web-backoffice/.env.example`. All `NEXT_PUBLIC_*` vars are bundled into the browser.

### Firebase Web SDK

| Variable | Default | Required | Description |
|---|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | — | **Yes** | Firebase Web API key (not a secret — safe in browser) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `teranga-app-990a8.firebaseapp.com` | **Yes** | Firebase Auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `teranga-app-990a8` | **Yes** | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `teranga-app-990a8.appspot.com` | **Yes** | Cloud Storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | — | **Yes** | FCM sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | — | **Yes** | Firebase App ID |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | — | No | Google Analytics measurement ID |

### API

| Variable | Default | Required | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | **Yes** | Teranga REST API base URL |

---

## Web Participant (`apps/web-participant`)

Source: `apps/web-participant/.env.example`. All `NEXT_PUBLIC_*` vars are bundled into the browser.

### Firebase Web SDK

| Variable | Default | Required | Description |
|---|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | — | **Yes** | Firebase Web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | — | **Yes** | Firebase Auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | — | **Yes** | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | — | **Yes** | Cloud Storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | — | **Yes** | FCM sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | — | **Yes** | Firebase App ID |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | — | No | Google Analytics measurement ID |

### URLs

| Variable | Default | Required | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | **Yes** | Teranga REST API base URL |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3002` | **Yes** | This app's public URL (used for canonical links and OG metadata) |
| `NEXT_PUBLIC_BACKOFFICE_URL` | `http://localhost:3001` | No | Backoffice URL (for "Manage your event" links) |

### Emulators

| Variable | Default | Required | Description |
|---|---|---|---|
| `NEXT_PUBLIC_USE_EMULATORS` | `true` | No | Set to `true` to connect to Firebase emulators in development. Set to `false` in staging/production |

---

## Cloud Functions (`apps/functions`)

Cloud Functions use Firebase environment config and Application Default Credentials (no `.env` file). The following variables are referenced in code:

| Variable | How Set | Description |
|---|---|---|
| `FIRESTORE_EMULATOR_HOST` | Firebase CLI / `firebase emulators:start` | Automatically set when running emulators. Points to `localhost:8080` |
| `FIREBASE_AUTH_EMULATOR_HOST` | Firebase CLI | Set when running Auth emulator. Points to `localhost:9099` |

Secrets for Cloud Functions (e.g., `RESEND_API_KEY` for email notifications triggered by Firestore writes) are set via Firebase Secret Manager:

```bash
firebase functions:secrets:set RESEND_API_KEY
```

---

## Flutter Mobile (`apps/mobile`)

The Flutter app uses `google-services.json` (Android) and `GoogleService-Info.plist` (iOS), generated by:

```bash
cd apps/mobile && flutterfire configure --project=teranga-app-990a8
```

These files are **gitignored** and must be regenerated per developer. They embed the Firebase Web API key, project ID, and app-specific identifiers.

Additional compile-time constants in `apps/mobile/lib/config/`:

| Constant | Description |
|---|---|
| `apiBaseUrl` | Teranga REST API base URL (set per build flavor: dev/staging/prod) |
| `useEmulators` | Whether to connect to Firebase emulators |

---

## CI/CD Environment Variables (GitHub Actions)

Set as repository secrets in GitHub → Settings → Secrets and variables → Actions.

| Secret | Used In | Description |
|---|---|---|
| `GCP_SA_KEY` | `deploy-staging.yml` | GCP service account JSON for Cloud Run deploy |
| `FIREBASE_TOKEN` | `deploy-staging.yml` | Firebase CI token for `firebase deploy` |
| `FIREBASE_PROJECT_ID` | `ci-gate.yml`, `deploy-staging.yml` | GCP project ID |
| `FIREBASE_STORAGE_BUCKET` | `deploy-staging.yml` | Cloud Storage bucket |
| `QR_SECRET` | `deploy-staging.yml` | Injected as Cloud Run env var |
| `QR_MASTER` | `deploy-staging.yml` | Injected as Cloud Run env var |
| `RESEND_API_KEY` | `deploy-staging.yml` | Injected as Cloud Run env var |
| `SENTRY_DSN` | `deploy-staging.yml` | Injected as Cloud Run env var |
| `WAVE_API_KEY` | `deploy-staging.yml` | Injected as Cloud Run env var |
| `ORANGE_MONEY_CLIENT_ID` | `deploy-staging.yml` | Injected as Cloud Run env var |
| `ORANGE_MONEY_CLIENT_SECRET` | `deploy-staging.yml` | Injected as Cloud Run env var |
| `NEXT_PUBLIC_API_URL` | `deploy-staging.yml` | Next.js build-time var for staging |
| `NEXT_PUBLIC_FIREBASE_*` | `deploy-staging.yml` | Firebase Web SDK config for staging builds |

---

## Staging vs. Production Values

| Variable | Staging | Production |
|---|---|---|
| `NODE_ENV` | `staging` | `production` |
| `FIREBASE_PROJECT_ID` | `teranga-app-990a8` | `teranga-events-prod` |
| `CORS_ORIGINS` | staging domain | production domain |
| `RATE_LIMIT_MAX` | `100` | `200` |
| `PLATFORM_FEE_RATE` | `0.05` | `0.05` |
| `QR_SECRET` | unique per env | unique per env — never reuse |

---

## Local Development Minimum

For local development with Firebase emulators, the minimum required API config is:

```bash
# apps/api/.env (minimum for local dev with emulators)
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

FIREBASE_PROJECT_ID=teranga-app-990a8
FIREBASE_STORAGE_BUCKET=teranga-app-990a8.appspot.com

QR_SECRET=local-dev-secret-minimum-32-chars-here
```

The emulators set `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` automatically — no additional config needed for local Firestore/Auth.
