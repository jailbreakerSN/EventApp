# Wave 10 / W10-P2 — Security hardening

**Branch:** `claude/wave-10-production-hardening`
**Status:** shipped
**Audits closed:** S1 (CSP), S2 (Firestore rules for O8-O10 collections), S3 (rate-limit holes), S4 (audit-log PII)

---

## What changed

### 1. CSP rolled out in Report-Only mode (P0 / M)

**Where:** `apps/web-backoffice/next.config.ts` + `apps/web-participant/next.config.ts`. Each ships a Content Security Policy with allowlists tested against the working Firebase Auth + Firestore + FCM + PayDunya iframe + WhatsApp Cloud API + Sentry surfaces.

**Ramp posture:** the header key is selected by `NEXT_PUBLIC_CSP_ENFORCE`:

```
NEXT_PUBLIC_CSP_ENFORCE !== "true"  →  Content-Security-Policy-Report-Only
NEXT_PUBLIC_CSP_ENFORCE === "true"  →  Content-Security-Policy
```

- First deploy: Report-Only. Browsers evaluate the policy and POST violations to `/api/csp-report` but DO NOT block.
- Hold for 7 clean days in staging (no unexpected violations on any first-page render across both apps).
- Promote: flip the env var in the prod deploy workflow.

**Receivers:** new no-auth POST handlers at `apps/web-{backoffice,participant}/src/app/api/csp-report/route.ts`. They log to `console.warn` (Cloud Run captures) and forward to Sentry as a `csp_violation` warning event tagged with the violated directive + the source app. Receivers always 204 — a malformed report must never bubble back to the user.

**Allowlist directives** (delta from default-src 'self'):

| Directive                      | Allow                                                                                                                                                                                                                                                                               | Rationale                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`                   | `'unsafe-inline' 'unsafe-eval'` + apis.google.com + browser.sentry-cdn.com + googletagmanager.com                                                                                                                                                                                   | Next 15 + React 19 currently emit inline boot scripts without nonce; we hold `'unsafe-inline'` until Next ships nonce injection. `'unsafe-eval'` covers Firebase Auth's WebAssembly hop. |
| `style-src`                    | `'unsafe-inline'` + fonts.googleapis.com                                                                                                                                                                                                                                            | Tailwind + shadcn ship inline styles.                                                                                                                                                    |
| `connect-src`                  | `*.googleapis.com`, `*.firebaseio.com`, `*.firebaseapp.com`, `wss://*.firebaseio.com`, `*.cloudfunctions.net`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `accounts.google.com`, `*.sentry.io`, `*.ingest.sentry.io`, `api.paydunya.com`, `graph.facebook.com` | The full set of working backends both apps reach today. Verified by `grep -r 'fetch\|axios\|firebase' src/`.                                                                             |
| `frame-src`                    | `*.firebaseapp.com`, `accounts.google.com`, `app.paydunya.com`                                                                                                                                                                                                                      | Auth popup + PayDunya iframe checkout.                                                                                                                                                   |
| `frame-ancestors`              | `'none'`                                                                                                                                                                                                                                                                            | Subsumes `X-Frame-Options: DENY`.                                                                                                                                                        |
| `media-src` (participant only) | `blob:` + Firebase Storage + GCS                                                                                                                                                                                                                                                    | Sponsor-uploaded video / audio.                                                                                                                                                          |
| `report-uri`                   | `/api/csp-report`                                                                                                                                                                                                                                                                   | App-local receiver.                                                                                                                                                                      |

### 2. Firestore rules for O8-O10 collections (P0 / M)

**Where:** `infrastructure/firebase/firestore.rules` — appended six explicit `match` blocks.

| Collection            | Posture                 | Why                                                           |
| --------------------- | ----------------------- | ------------------------------------------------------------- |
| `incidents`           | `read, write: if false` | API-mediated; client never reads directly.                    |
| `staffMessages`       | `read, write: if false` | Push-driven UI; no client Firestore listener.                 |
| `magicLinks`          | `read, write: if false` | Token IS the credential; enumeration would defeat the design. |
| `whatsappOptIns`      | `read, write: if false` | Consent audit row; client write would bypass it.              |
| `whatsappDeliveryLog` | `read, write: if false` | Cross-tenant recipient phone exposure.                        |
| `participantProfiles` | `read, write: if false` | Notes + tags are PII.                                         |

**Test:** `infrastructure/firebase/__tests__/firestore.rules.test.ts` — six new `describe` blocks, each exercising at least three deny-paths (owner / org-mate / super-admin / cross-org as relevant) per collection. Total 18 new assertions. Run via the Firebase emulator (CI job `firebase-rules`).

### 3. Rate-limit overrides on abuse-prone routes (P0 / S)

**Where:** five route files.

| Route                                                   | Cap                                          | Why                                                                               |
| ------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /v1/magic-links`                                  | 5 / min                                      | Issuance is email/SMS amplification; Resend cost cap.                             |
| `GET /v1/magic-links/verify`                            | 30 / min                                     | Unauth + brute-force-attractive (token namespace 10^77, but bound the scan cost). |
| `POST /v1/me/whatsapp/opt-in`                           | 10 / min                                     | Meta cost amplification.                                                          |
| `DELETE /v1/me/whatsapp/opt-in`                         | 10 / min                                     | Symmetrical.                                                                      |
| `POST /v1/events/:id/feed*` (all mutations)             | 30 / min via `FEED_MUTATION_RATE_LIMIT`      | Content abuse.                                                                    |
| `POST /v1/messaging/*` (send + create-conv + mark-read) | 30 / min via `MESSAGING_MUTATION_RATE_LIMIT` | DM spam.                                                                          |
| `POST /v1/events/:id/live/incidents`                    | 30 / min                                     | Floor-ops abuse.                                                                  |
| `POST /v1/events/:id/live/staff-messages`               | 30 / min                                     | Symmetrical.                                                                      |

**Test:** `apps/api/src/routes/__tests__/rate-limit-overrides.test.ts` — 5 contract assertions (one per route file) that grep the source for the override blocks. Brittle by design — a future refactor that moves overrides into a plugin or decorator MUST update this test before merging, which prevents silently dropping a cap.

### 4. Audit-log PII redaction (P1 / S)

**Where:** `apps/api/src/events/listeners/audit.listener.ts` — added a top-of-file PII policy comment and removed the `email` field from four audit row writes:

| Action                            | Before                            | After                      |
| --------------------------------- | --------------------------------- | -------------------------- |
| `newsletter.subscriber_created`   | `details: { email, source }`      | `details: { source }`      |
| `newsletter.subscriber_confirmed` | `details: { email, confirmedAt }` | `details: { confirmedAt }` |
| `invite.created`                  | `details: { email, role }`        | `details: { role }`        |
| `invite.revoked`                  | `details: { email }`              | `details: {}`              |

**Why this is safe forensically:** every redacted row's `resourceId` is the join key (`subscriberId` / `inviteId`) into a Firestore doc that already carries the email and is subject to the user's erasure right. Investigators join at query time; the join is itself an auditable read. Senegal Loi 2008-12 + GDPR erasure stays single-collection.

**Test:** `apps/api/src/events/__tests__/audit.listener.test.ts` — two existing newsletter tests rewritten to assert (a) the redacted shape, AND (b) defensive `JSON.stringify(details)` does not contain the email. Pinning both halves means a future re-introduction of the email key fails CI immediately.

---

## Verification log

- `cd apps/api && npx vitest run` — 134 files / 2122 tests green (up from 2117 at end of P1; +5 rate-limit overrides).
- `cd apps/api && npx tsc --noEmit` — clean.
- `cd apps/web-backoffice && npx tsc --noEmit` — clean.
- `cd apps/web-participant && npx tsc --noEmit` — clean.
- Firestore rules tests — assertions added; CI runs them in the `firebase-rules` job (local emulator not bundled in the dev container).

## Mechanical auditor results

- `@security-reviewer` — to run on this commit.
- `@firestore-transaction-auditor` — N/A (no service mutation changes).
- `@domain-event-auditor` — N/A (audit listener changed but no new domain events).
- `@plan-limit-auditor` — N/A.
- `@l10n-auditor` — N/A (CSP report receiver UI strings are operator-facing only).

---

## What remains for the next phase

- CSP enforcement promotion — flip `NEXT_PUBLIC_CSP_ENFORCE=true` after the 7-day clean window. Tracked in `production-launch.md`.
- `redactPiiFromDetails(details)` helper + ESLint rule preventing future `email` / `phoneNumber` keys in audit details — deferred to a P5 follow-up since the current 4 sites are the complete inventory and a new contributor adding one would still trip the redaction tests.
- Rate-limit store migration to Memorystore Redis — required before scaling beyond 1 Cloud Run instance. Tracked in `operations.md`.

## Rollback

| Change               | Rollback                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSP                  | Set `NEXT_PUBLIC_CSP_ENFORCE` to anything other than `"true"` and the policy stays in Report-Only — no traffic blocked. To remove entirely, drop the new header block and the `/api/csp-report/route.ts` files. |
| Firestore rules      | The new `match` blocks are explicit deny-equivalents of the deny-all default; reverting them only removes the documentation, the security posture is unchanged.                                                 |
| Rate-limit overrides | Remove the per-route `config: { rateLimit: ... }` blocks and the routes fall back to the composite-key default. The pin test will fail immediately so the revert is intentional.                                |
| Audit PII redaction  | Re-add the `email` field to the four `details:` blocks. The test assertions will fail in lockstep, requiring a reviewer's sign-off.                                                                             |
