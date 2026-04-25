---
title: CI / CD
status: shipped
last_updated: 2026-04-25
---

# CI / CD

> **Status: shipped** — Staging deploy pipeline is fully automated. Production deploy pipeline is planned (Wave 10).

All workflows live in `.github/workflows/`.

---

## CI gate (`ci.yml`)

Runs on every push to `main` or `develop`, and on every pull request.

### Jobs (run in dependency order)

```
shared-types-build
    ├─► api-checks (lint + type-check + unit tests + integration tests via emulator)
    ├─► functions-checks (type-check + build)
    ├─► web-backoffice-checks (lint + type-check + tests + Next.js build)
    ├─► web-participant-checks (lint + type-check + tests + Next.js build)
    └─► flutter-checks (analyze + test)

firestore-rules-syntax
firestore-index-coverage-audit
dependency-audit (CRITICAL = fail, HIGH = warn)

ci-gate (aggregates all jobs — PRs cannot merge until this passes)
```

### Key behaviors

- **Turbo caching** — unchanged packages skip their checks (hash-based cache)
- **Node 22** — pinned across all CI jobs to match Cloud Run
- **Firebase emulator** — API integration tests spin up a Firebase emulator in CI
- **Shared-types first** — all other jobs wait for `shared-types-build` to succeed

---

## Deploy to staging (`deploy-staging.yml`)

Triggers automatically when a commit is merged to `develop`.

### Steps

1. **GCP setup** — configure gcloud, derive Firebase config, enable APIs, set IAM
2. **Build API Docker image** → push to Artifact Registry
3. **Deploy API** → Cloud Run (`teranga-api`, europe-west1, 1 CPU, 512 Mi, max 2 instances)
4. **Build web-backoffice** → push to Artifact Registry
5. **Deploy web-backoffice** → Cloud Run
6. **Build web-participant** → push to Artifact Registry
7. **Deploy web-participant** → Cloud Run
8. **Firebase deploy** → rules + indexes + storage + functions
9. **Seed staging** → idempotent, skips if data exists
10. **QA fixtures** → always upserts role-coverage users
11. **Balance-ledger backfill** → deterministic replay of payments into ledger
12. **Smoke tests** → 5-retry health + readiness + events endpoint checks

Total duration: ~8–12 minutes on a warm cache.

---

## Manual workflows

### Seed staging (`seed-staging.yml`)

Run on demand to re-seed staging with test data. Safe to call at any time — idempotent.

```
Actions → Seed Staging → Run workflow
```

### Artifact Registry cleanup (`artifact-registry-cleanup.yml`)

Deletes Docker images older than the last 3 versions. Manual to avoid accidental deletion.

```
Actions → Artifact Registry Cleanup → Run workflow
```

### Claude AI review (`claude-review.yml`)

Runs the project subagents (`@security-reviewer`, `@domain-event-auditor`, etc.) against a PR. Manual dispatch — pass the PR number:

```
Actions → Claude AI Review → Run workflow → pr_number: 42
```

### Auto-rebase (`auto-rebase.yml`)

Automatically rebases stale PRs when the base branch is updated. Triggered by push to `develop`.

---

## Branch protection

`develop` and `main` require:
- CI gate passing
- At least one PR review
- No force pushes

---

## Secrets in CI

Secrets are stored in GitHub repository secrets and passed to workflows as environment variables. See [Secrets & env vars](./secrets-and-env.md) for the full list.

---

## Production deploy (planned)

> **📅 planned** — Wave 10. Will follow the same structure as staging deploy with:
> - `firebase use production` (project: `teranga-events-prod`)
> - Manual approval gate via GitHub Environment protection rules
> - Separate Cloud Run services
> - GCP Secret Manager for all secrets
