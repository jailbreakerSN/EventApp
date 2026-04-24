# API Keys — Operator & Integrator Guide

**Status:** shipped (T2.3 — PR #180)
**Scope:** Organization-scoped bearer credentials for server-to-server integrations.

## TL;DR

- Enterprise-plan orgs self-issue API keys via `/organization/api-keys`.
- Format: `terk_<env>_<40 chars base62>_<4-char checksum>`.
- Plaintext is shown **exactly once** at creation. We store only `SHA-256(key)`.
- Use the key as a `Authorization: Bearer terk_…` header on any `/v1/*` endpoint the key's scopes permit.
- Hard ceiling of **20 active keys per organization**.
- Rate-limited per-key independently of user rate-limits.

## For integrators

### Getting a key

1. As an org member with `organization:manage_billing`, open `/organization/api-keys`.
2. Click **Nouvelle clé**, give it a descriptive name, pick the narrowest scope set that meets your use case, and select the environment (`live` for prod, `test` for sandbox).
3. On success a modal reveals the plaintext **once**. Copy it immediately into a secrets manager (1Password, Bitwarden, AWS Secrets Manager, Vault, etc.). **Never** paste it into Slack, Git, or a shared document.
4. Acknowledge the copy prompt to dismiss the modal. Subsequent views of the key show only the non-secret prefix.

### Using a key

```bash
curl -H "Authorization: Bearer terk_live_<your key>" \
     https://api.teranga.sn/v1/events/<eventId>/registrations
```

Any `/v1/*` route whose permission is in your scope set will work. A route outside your scope set returns `403 FORBIDDEN`.

### Validating a key (no side-effects)

```bash
curl -H "Authorization: Bearer terk_live_<your key>" \
     https://api.teranga.sn/v1/me/whoami
```

Returns `{ uid: "apikey:<prefix>", isApiKey: true, apiKeyScopes: [...], apiKeyPermissions: [...], organizationId: "..." }`. Zero side-effects, no audit row, no rate-limit charge for the probe itself — safe to call from CI.

### V1 scope catalogue

| Scope                   | Grants                                                |
| ----------------------- | ----------------------------------------------------- |
| `event:read`            | Read your org's events (list, detail, agenda, status) |
| `registration:read_all` | Export participant lists (CRM sync, reporting)        |
| `badge:generate`        | Trigger badge PDF generation at scale                 |
| `checkin:scan`          | Integrate a hardware scanner or turnstile             |

Write scopes (create events, update registrations) are deferred to V2 — we want more audit context on API-initiated mutations before opening that surface.

### Errors

| Code                                         | Meaning                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `401 UNAUTHORIZED`                           | Key is invalid, revoked, malformed, or doesn't exist. Indistinguishable from "never existed" by design (prevents prefix-enumeration). |
| `403 FORBIDDEN`                              | Key is valid but the route's permission is not in your scope set.                                                                     |
| `403 ORGANIZATION_PLAN_LIMIT` (at issuance)  | Your org doesn't have the `apiAccess` feature flag — upgrade to enterprise.                                                           |
| `403 ORGANIZATION_PLAN_LIMIT` with `max: 20` | You've hit the 20-active-key ceiling. Revoke an unused key first.                                                                     |
| `409 CONFLICT` (on rotate)                   | The key was already revoked. Issue a new one instead of rotating a dead one.                                                          |

### Rotation

Rotate a key from `/organization/api-keys` → **Rotation**. The operation is atomic:

1. The old key is marked `revoked` inside a transaction.
2. A new key is minted inside the same transaction.
3. You see the new plaintext in the one-time modal.

The old key stops working the instant the transaction commits. There is no grace window — put the new key in your secrets manager and cut over your service to it, then verify with `/v1/me/whoami`.

### Revocation

Revoke any key from `/organization/api-keys` → **Révoquer**. Revocation is instant and irreversible. Revoked keys stay in the list for forensics (who issued it, when, who revoked it, why). They cannot be "unrevoked" — issue a new key if you need to resume access.

## For operators

### Architecture

- Collection: `apiKeys` (`apps/api/src/config/firebase.ts`).
- Doc id: the first 10 chars of the entropy-bearing body (`hashPrefix`).
- Stored: `SHA-256(key)` as `keyHash`, plus metadata. **No plaintext**.
- Auth middleware: `apps/api/src/middlewares/auth.middleware.ts` branches on the `terk_` prefix and calls `apiKeysService.verify()`.
- Scope → permission expansion: `SCOPE_TO_PERMISSIONS` in `packages/shared-types/src/api-keys.types.ts`.

### Audit trail

Every lifecycle event writes a row to `auditLogs` via the domain event bus:

- `api_key.created` — on issuance. Details: `name`, `scopes`, `environment`.
- `api_key.revoked` — on revocation. Details: `reason`.
- `api_key.rotated` — on atomic revoke+issue. Details: `previousApiKeyId`, `newApiKeyId`. (This is a _third_ audit row in addition to the `revoked` + `created` pair.)
- `api_key.verified` — on successful authentication. **Throttled** to at most one emit per `(key, ipHash, uaHash)` per hour. Details: 16-hex-char truncated SHA-256 of the IP and User-Agent.

Search any of these from `/admin/audit` → type "api_key" in the search box.

### Runbook — "customer's API key stopped working"

1. Ask the customer for the **first 10 chars** of the key (the `terk_live_` part plus a few more characters). That matches the doc id.
2. In `/admin/audit`, search for `api_key` with `resourceId` = that prefix. Look for:
   - `api_key.revoked` — intentional kill, or rotated. Ask the customer about recent rotations.
   - No recent `api_key.verified` → the key hasn't reached our auth layer. Check the customer's bearer header format.
   - `api_key.verified` with an unexpected `ipHash` → possible leak. Help them rotate.
3. If the key doesn't appear in the audit at all, it was never issued on this plan / env.

### Runbook — "API key leaked on GitHub"

1. Instruct the customer to open `/organization/api-keys` → find the leaked key → **Rotation**. This atomically kills the old key and mints a new one.
2. If the customer can't access the UI (e.g. the plan was downgraded mid-incident), a super-admin can impersonate the org admin via `/admin/users/<uid>/impersonate` → run the rotation from that session.
3. Follow-up: audit the `api_key.verified` stream for the compromised key — look for IPs that don't match the customer's known CI/infra. If found, escalate to `platform:security` role.

### Runbook — "announcement banner didn't appear"

1. Check `/admin/announcements` — is the row `active: true`? Did `expiresAt` pass?
2. The audience filter matters: `all` shows to everyone; `organizers` excludes participants; `participants` excludes organizers. Operators map to `organizers`.
3. The web client polls `/v1/announcements` every 5 minutes with a 4-minute staleTime. A brand-new announcement may take up to 5 minutes to appear on open tabs. Critical banners can't be dismissed by users until they expire or are toggled off.
4. If `/v1/announcements` returns 401 → the user is unauthenticated. Authenticate first.

### Runbook — emergency disable

If the `apiKeys` collection degrades or an incident demands a platform-wide freeze:

```bash
gcloud run services update teranga-api \
  --region=europe-west1 \
  --update-env-vars=API_KEY_AUTH_DISABLED=true
```

This short-circuits every `terk_*` bearer to `401` within seconds. Firebase-ID-token auth is unaffected. Revert the same way once the incident is resolved.

### Configuration

Environment variables (see `apps/api/.env.example`):

- `API_KEY_CHECKSUM_SECRET` — HMAC secret for the 4-char checksum. Rotating this **invalidates every outstanding key platform-wide** (treated as a customer-notification event). Min 32 chars.
- `API_KEY_AUTH_DISABLED` — kill-switch. Default `false`. Set to `true` to freeze API-key auth.

## Design decisions

- **Why `terk_` prefix?** Greppable on leaked-secret scanning (GitHub secret-scanning partner program, pre-commit hooks). Differentiates Teranga keys from every other `sk_*` / `ghp_*` / `lin_*` credential on an engineer's machine.
- **Why SHA-256, not bcrypt?** API keys are high-entropy (238 bits) so we don't need key-stretching. The throughput win matters at Cloud Run scale — every authenticated request hashes the presented plaintext.
- **Why 20 active keys per org?** Enough for a realistic enterprise footprint (CRM sync + scanner fleet + CI + spares) while forcing key hygiene. Raise the constant in `apps/api/src/services/api-keys.service.ts` and document the bump in CLAUDE.md before changing.
- **Why an atomic rotate?** Matches the industry pattern (Stripe, GitHub) and removes the window where both keys are valid simultaneously (which would complicate audit).
- **Why no TTL?** Keys are long-lived by design. Revocation is a status flip (preserves audit). See `infrastructure/firebase/firestore.ttl.md` for the "collections intentionally without TTL" rationale.

## V2 roadmap

- **IP allowlist per key** — restrict a key to a set of CIDRs.
- **Usage analytics page** — per-key request counts + error rate breakdown.
- **Self-service expiry** — operators set an expiration date at issuance; the auth middleware rejects expired keys.
- **Write scopes** — `event:create`, `registration:update`, etc. Requires better audit discipline around API-initiated mutations.
- **Cross-device dismissal persistence** — if compliance ever needs "user X acknowledged warning Y" per-user, add an acknowledge endpoint instead of localStorage.

## Related docs

- `CLAUDE.md` § Authentication Flow (canonical architecture).
- `apps/api/.env.example` (environment reference).
- `docs/admin-overhaul/PLAN.md` Phase 6 (admin UX context).
- `docs/admin-overhaul/FIDELITY-AUDIT.md` P6.3 (T2.3 fidelity).
