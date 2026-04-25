---
title: Staging reset runbook
status: shipped
last_updated: 2026-04-25
audience: operators, on-call, demo crew
---

# Staging reset runbook

Wipes the **staging** project (or a local emulator) to an empty state and re-seeds it from the current fixture set. Designed to be safe to run multiple times a day during demo prep without surprises.

> **Production is NOT in scope.** The script's allow-list refuses any `FIREBASE_PROJECT_ID` outside `teranga-app-990a8` and `teranga-events-dev`. Production reset is a manual, audited Firebase Console operation by the platform owner — there is no automated path.

## What gets wiped

Three surfaces in lock-step:

1. **Firestore** — every collection in `RESETTABLE_COLLECTIONS` (`scripts/seed/config.ts`). Plans catalog (`plans/`) is **preserved**.
2. **Firebase Auth** — every user with an `@teranga.dev` email (the seed domain; documented as dev-only).
3. **Cloud Storage** — every object whose path starts with `seed/`, `badges/`, `events/`, `organizations/`, or `users/`. Anything outside those prefixes is left alone.

## The 3-gate confirmation flow

| Gate | Variable | Purpose |
|------|----------|---------|
| **1. Allow-list** | `FIREBASE_PROJECT_ID` | Must be in the allow-list (production excluded). Validates target before any code path runs. |
| **2. Explicit confirm** | `SEED_RESET_CONFIRM=YES_RESET` | Cannot be set by mistake. Forces conscious intent. |
| **3. Typed echo (non-emulator)** | `CONFIRM_PROJECT=<project-id>` AND `CONFIRM_PHRASE="RESET STAGING DATABASE NOW"` | Two extra typo-resistant statements; both must match. |

For local emulators, only gates 1 + 2 are required (writes are cheap and reversible). For staging, all three are required.

## Quickstart — local emulator

```bash
# 1. Start emulators
firebase emulators:start

# 2. (recommended) preview what would be deleted
SEED_RESET_CONFIRM=YES_RESET npm run seed:reset:dry-run

# 3. Run the real reset
SEED_RESET_CONFIRM=YES_RESET npm run seed:reset

# 4. Reload fixtures
npm run seed
```

## Quickstart — staging (manual)

```bash
SEED_TARGET=staging \
FIREBASE_PROJECT_ID=teranga-app-990a8 \
FIREBASE_STORAGE_BUCKET=teranga-app-990a8.appspot.com \
SEED_RESET_CONFIRM=YES_RESET \
CONFIRM_PROJECT=teranga-app-990a8 \
CONFIRM_PHRASE="RESET STAGING DATABASE NOW" \
GOOGLE_APPLICATION_CREDENTIALS=./service-account.staging.json \
  npm run seed:reset
```

> **Always run dry-run first** on staging. Add `--dry-run` to any command — only the orchestrator's "would delete" tally runs.

## Quickstart — staging (GitHub Actions)

The `.github/workflows/seed-staging.yml` workflow wraps these steps with operator-friendly inputs. See the workflow file for the latest gate inputs.

## Output anatomy

```
⚠️  RESET (WRITE): target=staging, project=teranga-app-990a8, label=staging, bucket=teranga-app-990a8.appspot.com

📦 Firestore collections:
  ✓ events                       — deleted 102 docs
  ✓ registrations                — deleted 1989 docs
  · sessionBookmarks             — empty
  ...

🔐 Auth users (@teranga.dev):
  ✓ deleted 47 auth users

🗂️  Storage bucket (teranga-app-990a8.appspot.com):
  ✓ seed/                        — deleted 12 objects
  ✓ badges/                      — deleted 23 objects
  · events/                      — empty
  ...
  total storage deleted: 35

✅ Reset complete. Run `npm run seed` (or `seed:staging`) to repopulate.
```

## Failure modes

| Scenario | Behavior | Operator action |
|----------|----------|----------------|
| Wrong project id | Throws on import (gate 1) | Recheck `FIREBASE_PROJECT_ID` |
| Forgot `SEED_RESET_CONFIRM` | Throws on import (gate 2) | Add the env var |
| Typo in `CONFIRM_PROJECT` | Throws before any write (gate 3a) | Recheck and retype |
| Typo in `CONFIRM_PHRASE` | Throws before any write (gate 3b) | Phrase is case-sensitive: `RESET STAGING DATABASE NOW` |
| Storage bucket has no `@teranga.dev` perms | `bucket.getFiles()` 403s | Re-issue service account key with Storage Admin scope |
| Reset runs to completion but seed fails | Database is empty | Run `npm run seed` again — it's idempotent |
| Auth deletion partial (rate-limited) | Some users remain | Re-run; `auth.deleteUsers()` is idempotent on already-deleted UIDs |

## Why three gates

A single env var is too easy to leave in a shell history. Two adds friction but doesn't catch a stale `CONFIRM_PROJECT=teranga-events-prod` from a previous workflow run. Three gates with one being a typed phrase that has no purpose other than to confirm intent makes accidental runs essentially impossible.

The phrase `"RESET STAGING DATABASE NOW"` is intentionally chosen to:

- Be typeable but impossible to copy-paste from any other context.
- Include the word `STAGING` so `CONFIRM_PHRASE="RESET PRODUCTION DATABASE NOW"` would still fail the comparison.
- Be obviously not a sensible default value to leave in any environment.

## Related references

- `scripts/seed-reset.ts` — implementation
- `scripts/seed/config.ts` — allow-list + RESETTABLE_COLLECTIONS
- `.github/workflows/seed-staging.yml` — CI wrapper
- [`docs/audit-2026-04-25/REPORT.md`](../../docs/audit-2026-04-25/REPORT.md) — Sprint A audit findings S4 + S5
- [`docs-v2/00-getting-started/demo-walkthrough.md`](../00-getting-started/demo-walkthrough.md) — what the seeded state looks like after a reload
