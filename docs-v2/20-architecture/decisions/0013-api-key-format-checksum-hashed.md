# ADR-0013: API key format `terk_*` with checksum + SHA-256 hashed storage

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

Phase 2.3 ships organization-scoped API keys for integrators (CRM imports, analytics pulls, custom badge printers). The keys must:

1. Be self-identifiable in logs and source code (so a leaked key in a GitHub gist can be matched to Teranga and revoked).
2. Reject typos before any database read (cost-control + protect against scanning attacks).
3. Be unable to be reconstructed from anything stored at rest (database breach must not yield usable credentials).
4. Verify with constant time (no timing oracle for key length / prefix matching).
5. Distinguish staging from production at a glance (prevent integrators from accidentally hitting prod with a staging key).

Standard options:

1. **UUIDv4** — opaque, no self-identification, no checksum.
2. **Random base62** — opaque, fast, no structure.
3. **Stripe-style prefixed key** with checksum — `sk_live_<random>_<checksum>`, hashed at rest.
4. **JWT** — self-contained, but requires either a shared signing key (revocation = pain) or a per-key key (operational complexity).

GitHub's secret scanning matches well-known prefixed formats. AWS, GitHub, Stripe all converge on prefixed-with-checksum.

---

## Decision

**API keys are formatted `terk_<env>_<40 chars base62>_<4-char checksum>`. Stored as SHA-256 hash. Verified in constant time.**

```text
terk_prod_5fH3jKqL2nP9rT4vW8xZ1aBcD6eFgHiJkMnOpQrSt_uVw2
└──┘ └──┘ └──────────────────── 40 chars ──────────────────┘ └──┘
prefix env  random base62 (entropy)                          checksum
```

- **`terk_`** — fixed prefix, GitHub secret-scanning compatible (https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partner-program).
- **`<env>`** — `dev` / `staging` / `prod`. Visible at a glance.
- **40 chars base62** — ~238 bits of entropy.
- **4-char checksum** — HMAC-SHA256 of `prefix_env_random` truncated to 4 base62 chars, derived with a published checksum salt (NOT the verification secret). Validates the key shape before any Firestore read.
- **Storage** — `apiKeys/{hashPrefix}` document where `hashPrefix = SHA-256(plaintext).slice(0, 16)`, document body contains `hash: SHA-256(plaintext)` (full).
- **Verification** — `parseApiKey()` validates format + checksum, looks up `apiKeys/{hashPrefix}`, `crypto.timingSafeEqual` compares stored hash vs computed hash.
- **Plaintext returned exactly once** at creation. Lost = rotate.
- **Kill-switch** — `API_KEY_AUTH_DISABLED=true` env var rejects all `terk_*` requests at the middleware level without a code deploy.

---

## Reasons

- **Self-identification.** A leaked `terk_prod_*` in a public repo is searchable. GitHub's secret-scanning partner program flags it automatically.
- **Cost-control.** A typoed key fails the checksum check before any Firestore read. Brute-force scans cost nothing on the database.
- **Database breach is not catastrophic.** Stored hashes can't be replayed. Attacker would need to brute-force SHA-256 of a 238-bit secret — infeasible.
- **Constant-time verification.** `timingSafeEqual` prevents timing oracles on prefix matching.
- **Environment safety.** A `terk_dev_` key sent to `api.teranga.sn` (prod) is rejected by the env check before any other logic runs.
- **Operational kill-switch.** `API_KEY_AUTH_DISABLED=true` lets ops disable all integrations in seconds during an incident, without redeploy.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| UUIDv4 | No prefix → not searchable on leak. No checksum → typo costs a DB read. |
| JWT signed with platform secret | Revocation requires a denylist anyway; loses the storage simplicity. |
| Per-key signing keys | Operational nightmare for org admins. |
| Bearer Firebase ID tokens for integrations | Firebase Auth is for end-users; integrators don't have a UID flow. |
| Hashing with bcrypt | Slower than SHA-256, no benefit (plaintext entropy is already huge). |

---

## Conventions

- **Format regex:** `^terk_(dev|staging|prod)_[A-Za-z0-9]{40}_[A-Za-z0-9]{4}$`.
- **Checksum salt** is published in code (not a secret) — its role is collision-detection on user typos, not authentication.
- **`/v1/me/whoami`** is the zero-side-effect probe for integrators to validate a key + inspect permissions.
- **Scopes** map to the same permission strings as ADR-0011 RBAC. An API key has a fixed scope set at creation.
- **Audit:** every API key request is audit-logged (request ID, hashPrefix only — never the plaintext).
- **Rotation:** keys do not expire by default. Rotation is opt-in via the org admin UI.

---

## Consequences

**Positive**

- Leaked keys are detectable + revocable in minutes.
- Database breach yields no usable credentials.
- Integrators have a clean self-service flow (create → store securely → use).
- Incident response has a single env-var kill-switch.

**Negative**

- One extra "checksum salt" published in code — small ceremony, but a documented decision.
- Keys cannot be "regenerated" (no plaintext stored). UX must communicate this clearly. Done in `docs/api-keys.md`.
- 4-char checksum is not cryptographic protection — only typo protection. Rules in CLAUDE.md make this explicit.

**Follow-ups**

- GitHub secret-scanning partner program enrollment (planned, post-launch).
- Per-key rate limits (planned, Wave 8).
- Per-key IP allowlists (planned, enterprise plan).

---

## References

- `apps/api/src/services/api-keys.service.ts` — generation + verification.
- `apps/api/src/middlewares/auth.middleware.ts` — `terk_*` branch handling.
- `apps/api/src/utils/api-key-format.ts` — `parseApiKey()` + checksum logic.
- `docs/api-keys.md` — operator + integrator guide.
- CLAUDE.md → "Authentication Flow" + "Security Hardening Checklist".
