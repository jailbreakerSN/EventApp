---
title: "ADR-0016: Runtime secrets via GCP Secret Manager"
status: accepted
last_updated: 2026-04-26
---

# ADR-0016: Runtime secrets via GCP Secret Manager

## Status

Accepted — 2026-04-26.

## Context

Phase 1 + Phase 2 of the payments roadmap added 6 sensitive runtime secrets that the API reads at boot:

| Secret | Source | Sensitivity |
|---|---|---|
| `QR_SECRET` | HMAC key for QR badge signing | HIGH |
| `WEBHOOK_SECRET` (alias `PAYMENT_WEBHOOK_SECRET`) | Mock webhook HMAC + prod fallback | MED |
| `RESEND_API_KEY` | Resend transactional email API key | HIGH |
| `PAYDUNYA_MASTER_KEY` | PayDunya merchant id + IPN webhook signing | CRITICAL |
| `PAYDUNYA_PRIVATE_KEY` | PayDunya server-to-server auth | CRITICAL |
| `PAYDUNYA_TOKEN` | PayDunya sensitive ops header | CRITICAL |

Until this ADR, the deploy workflow (`deploy-staging.yml`) injected these as plain Cloud Run environment variables via `gcloud run deploy --set-env-vars`. The values were read from GitHub Environment Secrets at deploy time and stored on the Cloud Run service config in plaintext.

### Threat model

| Risk | Impact under `--set-env-vars` |
|---|---|
| Anyone with `roles/run.viewer` (read Cloud Run config) | Reads all 6 secret values via `gcloud run services describe` |
| Anyone with `roles/run.developer` or higher | Reads + can modify |
| Cloud Run console screenshare during incident triage | Secrets visible in the "Variables & Secrets" tab |
| `gcloud run services describe --format=export` output committed to a runbook | Plaintext secrets leak into git history |
| GCP Audit Logs access reveal | The full `set-env-vars` payload is logged on every deploy in `cloudaudit.googleapis.com` |

The container image and source code never carry the secrets — that part was already safe — but the Cloud Run **service configuration** carried them in plaintext and was visible to a much broader set of IAM principals than the secrets themselves should have warranted.

For PayDunya specifically (the trigger for this ADR), the keys are tied to an actual merchant account that processes real money. A leak via `roles/run.viewer` would let an attacker:

- Forge IPN webhooks (the SHA-512 of MasterKey is the webhook signature key)
- Impersonate the merchant to PayDunya's API (call `initiate`/`refund` server-to-server)
- Read sensitive customer transaction history via `verify()`

## Decision

**All 6 sensitive runtime secrets MUST be stored in GCP Secret Manager and bound to the Cloud Run service via `--update-secrets="ENV_VAR=SECRET_NAME:latest"`.** The Cloud Run service config carries only secret references (`secretKeyRef`); the values resolve via the runtime SA at instance startup.

### Implementation

Two-tier architecture:

```
┌─ GitHub Environment Secrets ─────────────────────────────────────┐
│  Settings → Environments → staging → Environment secrets         │
│  Source of truth for CI/CD pipeline configuration                │
│  6 entries: QR_SECRET / WEBHOOK_SECRET / RESEND_API_KEY /        │
│             PAYDUNYA_MASTER_KEY / PAYDUNYA_PRIVATE_KEY /         │
│             PAYDUNYA_TOKEN                                       │
└────────────────────────┬─────────────────────────────────────────┘
                         │ Read once at workflow run time
                         ▼
┌─ secrets-bootstrap.yml (workflow_dispatch, idempotent) ──────────┐
│  Manual trigger by an operator. Reads the GH Secrets, then:      │
│   1. gcloud secrets create / versions add per secret             │
│   2. add-iam-policy-binding (per-secret accessor to Cloud Run SA)│
│   3. gcloud run services update                                  │
│        --remove-env-vars=<6 names>                               │
│        --update-secrets="<6 bindings>"                           │
└────────────────────────┬─────────────────────────────────────────┘
                         │ Provisions
                         ▼
┌─ GCP Secret Manager (project-scoped) ────────────────────────────┐
│  projects/<id>/secrets/QR_SECRET                                 │
│  projects/<id>/secrets/WEBHOOK_SECRET                            │
│  projects/<id>/secrets/RESEND_API_KEY                            │
│  projects/<id>/secrets/PAYDUNYA_*                                │
│  IAM: roles/secretmanager.secretAccessor → Cloud Run runtime SA  │
└────────────────────────┬─────────────────────────────────────────┘
                         │ Cloud Run pulls value at instance start
                         ▼
┌─ Cloud Run instance (process.env at runtime) ────────────────────┐
│  process.env.QR_SECRET           = "abc123..." (in-memory only)  │
│  process.env.PAYDUNYA_MASTER_KEY = "kOUy..." (in-memory only)    │
│  No plaintext on disk; not in deploy logs; not in service config │
└──────────────────────────────────────────────────────────────────┘
```

Plain env vars are still used for non-sensitive config (`NODE_ENV`, `FIREBASE_PROJECT_ID`, `CORS_ORIGINS`, `API_BASE_URL`, `RATE_LIMIT_*`, `LOG_LEVEL`, `PAYDUNYA_MODE`, `SENTRY_DSN`).

`SENTRY_DSN` stays as a plain env var deliberately: the DSN format is `https://<public_key>@<org>.ingest.sentry.io/<project>` and is designed to be embedded in client SDK bundles. Treating it as a secret is theatre.

### Operations

| Action | Procedure |
|---|---|
| Initial provisioning | Operator runs `secrets-bootstrap.yml` manually once per environment. Idempotent. |
| Rotation | Update value in GH Environment Secret → re-run `secrets-bootstrap.yml` → Cloud Run picks up new `:latest` at next instance restart |
| Read a secret value | Requires `roles/secretmanager.secretAccessor` on the specific secret. Logged in `cloudaudit.googleapis.com` |
| Add a new secret | Add it to GH → add it to the `SECRETS=()` array in `secrets-bootstrap.yml` → add it to `--update-secrets` binding list → re-run |

### IAM scoping

The Cloud Run runtime SA (default compute SA `<project_number>-compute@developer.gserviceaccount.com`) holds **per-secret** `roles/secretmanager.secretAccessor` bindings, NOT a project-wide grant. This means:

- Adding a new secret requires explicit IAM grant — no transitive access via wildcards
- An IAM audit can list "every principal that can read PAYDUNYA_PRIVATE_KEY" with one query
- Future SA scope-down (e.g., per-service runtime SAs) doesn't lose access piecemeal

### Cloud Run binding semantics

The `secrets-bootstrap.yml` workflow uses `--update-secrets` (not `--set-secrets`) so existing bindings (`INTERNAL_DISPATCH_SECRET` from `notification-ops-prereqs.yml`) are preserved.

The migration step from plain env vars to secret bindings runs `--remove-env-vars` and `--update-secrets` in the SAME `gcloud run services update` call, so:

- Plain env var is removed
- Secret binding is added
- One revision update, atomic — no intermediate state where the env var is missing

`PAYMENT_WEBHOOK_SECRET` (read by `payment.service.ts`) is bound to the SAME Secret Manager entry as `WEBHOOK_SECRET` (read by the central config schema). Cloud Run supports aliasing: `--update-secrets="WEBHOOK_SECRET=WEBHOOK_SECRET:latest,PAYMENT_WEBHOOK_SECRET=WEBHOOK_SECRET:latest"`. One rotation updates both code paths.

## Consequences

### Positive

- **Security baseline upgrade.** `roles/run.viewer` no longer reveals secret values. Per-secret IAM gates read access.
- **Compliance alignment.** SOC 2, GDPR, PCI all expect "secrets accessible only with explicit IAM" — `--update-secrets` satisfies this; `--set-env-vars` does not.
- **Audit trail.** Every read of a secret value generates a `secretmanager.versions.access` log entry in Cloud Audit Logs.
- **Versioning + rotation without redeploy.** Adding a new version (`gcloud secrets versions add`) is picked up by the next Cloud Run instance restart without changing the binding (`:latest`) or rebuilding the image.
- **Rollback capability.** Previous secret versions are retained; `gcloud secrets versions disable <ver>` + add a new version pointing at an old value re-enables the prior credential.

### Negative

- **+1 manual step on environment bootstrap.** A first-time deploy to a new environment requires running `secrets-bootstrap.yml` BEFORE the regular `deploy-staging.yml` deploy can succeed. Without the bindings, the Cloud Run revision boots with empty env vars and `assertProviderSecrets()` refuses to start.
- **+~50–100ms cold-start latency per secret.** Cloud Run fetches each bound secret on instance startup. Cached after warm-up. At our scale (~7 secrets, ~1 cold start per minute on staging) the impact is negligible.
- **Pricing.** Secret Manager bills $0.06 per active secret-month and $0.03 per 10 000 access operations. For 7 secrets × 2 environments × 1 access per cold start, the projected monthly cost is **< $1**.
- **GitHub-Secrets-to-Secret-Manager drift risk.** The two stores can diverge if an operator updates one without the other. Mitigation: GH Environment Secrets are the canonical source; `secrets-bootstrap.yml` is the one-way bridge. Drift monitor can be added in Phase 3 if needed.

### Neutral

- The container image still receives no secrets at build time — that posture was already correct.
- `apps/api/src/config/assert-provider-secrets.ts` works the same regardless of whether values come from `--set-env-vars` or `--update-secrets` — both surface as `process.env.X` to the Node.js process.

## Migration sequence (one-time per environment)

For an environment that already runs the API with plain `--set-env-vars` (the state after PR #195 merged):

1. **Verify GH Environment Secrets are populated** — `secrets-bootstrap.yml` reads them. Missing values fail the workflow with a clear error message naming the missing secret.
2. **Run `secrets-bootstrap.yml` manually** with `dry_run=true` first to preview, then `dry_run=false` to apply. The workflow:
   - Provisions Secret Manager entries (creates secret + adds first version)
   - Grants per-secret IAM to Cloud Run SA
   - Runs `gcloud run services update --remove-env-vars=... --update-secrets=...` against the existing service — atomic transition.
3. **Verify the migration** with `gcloud run services describe teranga-api-staging --format='get(spec.template.spec.containers[0].env[*])'`. The 6 var names should appear with `secretKeyRef` entries; the previous plaintext values should be gone.
4. **Subsequent normal deploys** of `deploy-staging.yml` (push to develop) keep the secret bindings; only plain env vars are updated.

## Future work

- **Production environment** — when `deploy-production.yml` is created, this ADR's pattern is the default. No `--set-env-vars` for any sensitive runtime secret.
- **Per-service runtime SA** — currently the Cloud Run runtime SA is the default compute SA shared with Cloud Functions. Phase 3 hardening: dedicated SA per service with `--service-account` override on Cloud Run, so a Cloud Functions compromise doesn't grant API secret access (and vice-versa).
- **Drift monitor** — scheduled Cloud Function or GitHub Action that asserts every GH Environment Secret has a matching Secret Manager entry with `:latest` value SHA-256 equal to the GH value. Phase 3+.
- **Pinned versions** — replace `:latest` with `:N` so a rotation is an explicit deploy event. Defer to Phase 3+ when rotation discipline matures.

## Related

- [`secrets-bootstrap.yml`](../../.github/workflows/secrets-bootstrap.yml) — the bootstrap workflow
- [`deploy-staging.yml`](../../.github/workflows/deploy-staging.yml) — the deploy workflow (post-migration)
- [`notification-ops-prereqs.yml`](../../.github/workflows/notification-ops-prereqs.yml) — the prior-art pattern for `INTERNAL_DISPATCH_SECRET`
- [`paydunya-sandbox-runbook.md`](../../30-api/providers/paydunya-sandbox-runbook.md) §6 — operator runbook
- [P1-18 boot assertion](../../30-api/audits/payment-readiness-2026-04-26.md) — `assertProviderSecrets()` that this ADR's setup feeds

## Decision recorded by

Claude (assistant) on behalf of the Teranga engineering team, following an explicit security review request from the operator after PR #195 merged.
