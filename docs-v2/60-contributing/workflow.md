---
title: Git Workflow
status: shipped
last_updated: 2026-04-25
---

# Git Workflow

---

## Branching strategy

The project uses **trunk-based development** with short-lived feature branches.

```
main (production releases)
  ▲
  │ release PR
develop (integration trunk — always deployable)
  ▲
  │ feature/fix/chore PRs
feature/wave-2-offline-checkin
fix/qr-signature-validation
chore/update-deps
```

**Never push directly to `develop` or `main`.** Always create a branch and open a PR.

### Branch naming

| Prefix | Use for | Example |
|---|---|---|
| `feature/` | New features | `feature/wave-3-participant-app` |
| `fix/` | Bug fixes | `fix/qr-clock-skew` |
| `refactor/` | Code improvements (no behavior change) | `refactor/extract-payment-service` |
| `chore/` | Tooling, deps, config | `chore/update-firebase-admin` |
| `docs/` | Documentation only | `docs/api-reference` |
| `hotfix/` | Urgent production fixes | `hotfix/registration-crash` |

---

## Conventional commits

All commits must follow the Conventional Commits format:

```
type(scope): concise imperative description (max 72 chars)

Body: explain WHAT changed and WHY — not which files were touched.
Group multi-area changes with bullet points.

Close #123 (if applicable)
```

### Types

| Type | Use for |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change with no behavior change |
| `test` | Adding/fixing tests |
| `chore` | Tooling, dependencies, CI |
| `docs` | Documentation only |
| `perf` | Performance improvement |
| `ci` | CI/CD workflow changes |

### Scopes

| Scope | Area |
|---|---|
| `api` | Fastify API |
| `web` | Web back-office |
| `participant` | Web participant app |
| `mobile` | Flutter app |
| `shared-types` | @teranga/shared-types package |
| `shared-ui` | @teranga/shared-ui package |
| `functions` | Firebase Cloud Functions |
| `infra` | Firebase rules, indexes, Terraform |
| `platform` | Cross-cutting (multiple areas) |

### Good commit message example

```
feat(api): add QR v4 key rotation endpoint

Add POST /v1/events/:id/qr-key/rotate that mints a new qrKid,
pushes the old kid to qrKidHistory, and invalidates derived signing
keys for future badge generation. Old badges continue to verify
against keys in qrKidHistory for the overlap window.

Audit event: event.qr_key_rotated

All 412 tests pass.
```

### Forbidden commit messages

- `fix stuff`
- `update files`
- `WIP`
- `misc changes`
- `checkpoint`

---

## Pull request process

1. Create branch from `develop`
2. Make changes, commit with conventional commits
3. Push and open a PR against `develop`
4. PR description must have:
   - `## Summary` section — bullet points of all changes
   - `## Test plan` — what was tested
5. CI gate must pass before merge
6. Keep PR description updated on every push
7. Delete branch after merge

---

## After pushing a PR

If your change touches service files, routes, or Firestore rules, run the project subagents before requesting review:

```
@security-reviewer
@domain-event-auditor
@firestore-transaction-auditor
```

If your change touches events, registrations, members, or subscriptions:
```
@plan-limit-auditor
```

If your change touches UI:
```
@l10n-auditor
```

---

## Merge strategy

- Prefer **squash merge** for feature branches (clean develop history)
- Use **merge commit** for release PRs (develop → main) to preserve the full release history
- **Never force-push to `develop` or `main`**

---

## Release tagging

Releases are tagged on `main` with semver:

```bash
git tag -a v0.2.0 -m "Wave 2: Check-in API & Dashboard"
git push origin v0.2.0
```

| Wave | Version |
|---|---|
| Wave 1 | v0.1.0 |
| Wave 2 | v0.2.0 |
| Wave 3 | v0.3.0 |
| Production launch | v1.0.0 |
