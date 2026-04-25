# `@teranga/functions`

Teranga **Firebase Cloud Functions v2** — event-triggered side effects only. The HTTP REST API runs separately on Cloud Run (see [`apps/api/`](../api/) and [ADR-0001](../../docs-v2/20-architecture/decisions/0001-cloud-run-vs-functions.md)).

> **Canonical reference:** [`docs-v2/30-api/`](../../docs-v2/30-api/) covers the HTTP routes; this package's triggers are documented inline in their source files.

## Why Functions are limited to triggers

[ADR-0001](../../docs-v2/20-architecture/decisions/0001-cloud-run-vs-functions.md) details the trade-offs. In short: cold starts are unacceptable for a 200-route API serving event check-ins, but they're fine for fire-and-forget triggers (badge generation when a registration is created, scheduled cleanup, audit log fan-out, etc.).

## What this package contains

- **Auth triggers** — provision user document on Firebase Auth user create.
- **Firestore triggers** — generate badges when a registration is created, fan out feed posts, dispatch notifications.
- **Pub/Sub / Scheduler triggers** — daily aggregations, abandoned cart sweeps, badge expiry.
- **HTTP triggers** — none. All HTTP routes live in `apps/api`.

## Region

Every trigger is deployed to `europe-west1` to keep latency to Senegal modest (~80 ms) and to colocate with the Firestore project. See CLAUDE.md → "Common Pitfalls" §5.

## Local dev

```bash
# 1. Build (TypeScript → JS in lib/)
npm run build --workspace=@teranga/functions

# 2. Start the Functions emulator (with Firestore + Auth as triggers)
firebase emulators:start --only functions,firestore,auth
```

The emulator runs on port 5001. Triggers fire automatically when the corresponding Firestore docs / Auth users are created in the Firestore + Auth emulators.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | TypeScript compile to `lib/` |
| `npm run dev` | Watch-mode build via `tsc -w` |
| `npm run lint` | ESLint |
| `npm run type-check` | `tsc --noEmit` |

## Deployment

```bash
firebase deploy --only functions
```

Pinned engine: **Node 22** (`engines.node = "22"` in `package.json`). Firebase Functions v2 v2 runtime aligns with Node 22 — keep this version in sync with the rest of the monorepo (see CI's `NODE_VERSION` env).

## Common pitfalls

- **Region mismatch.** All triggers must use `europe-west1`. Mismatched regions cause silent failures (the trigger never fires).
- **Cold starts.** Acceptable for triggers (latency target: < 30 s p99), unacceptable for HTTP — that's why HTTP lives on Cloud Run.
- **Build before deploy.** `firebase deploy` reads from `lib/`, not `src/`. Always `npm run build` first.
- **Idempotency.** Firestore triggers can fire more than once for the same write. Every trigger handler must be idempotent (use a transaction with a marker doc, or check the result state).
