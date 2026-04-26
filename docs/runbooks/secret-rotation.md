# Runbook — Secret rotation

> **Wave 10 / W10-P2 / S5.** Operator-facing procedure for rotating every cryptographic secret the Teranga platform depends on.
> Linked from `docs/runbooks/production-launch.md` and from the `apps/api/.env.example` rotation header.

This runbook is **mandatory reading before any secret rotation** in production. Routine quarterly rotation drills should follow these steps; an emergency rotation (suspected compromise) follows the same steps with the dual-running window collapsed to zero.

---

## TL;DR — common patterns

| Secret                                        | Coupling                              | Dual-running supported?                         | Audit emission                                |
| --------------------------------------------- | ------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `QR_SECRET`                                   | Magic-link HMAC reuses it (see below) | Yes — via `qrKidHistory` / `kid` rotation       | `event.qr_key_rotated`                        |
| `PAYDUNYA_MASTER_KEY`                         | Webhook signature verification        | No — single secret, hard cutover                | `payment.tampering_attempted` (if mismatched) |
| `PAYDUNYA_PRIVATE_KEY`                        | API auth to PayDunya                  | No — single secret                              | none directly; surfaced via deploy logs       |
| `WHATSAPP_APP_SECRET`                         | Meta webhook signature                | No — single secret, hard cutover                | none directly; failed signatures land as 4xx  |
| `RESEND_API_KEY`                              | Outbound email                        | No — single secret, hard cutover                | none directly; sends fail until rotated       |
| `WEBHOOK_SECRET` (= `PAYMENT_WEBHOOK_SECRET`) | Inbound payment webhook signature     | No — single secret                              | `payment.tampering_attempted`                 |
| `NEWSLETTER_CONFIRM_SECRET`                   | Newsletter HMAC token                 | No — but old tokens silently fail post-rotation | none                                          |
| `UNSUBSCRIBE_SECRET`                          | RFC 8058 list-unsubscribe HMAC        | No — old links 410 post-rotation                | none                                          |
| `METRICS_AUTH_TOKEN`                          | Prometheus scrape                     | Yes (rotate with Cloud Run env update)          | none                                          |
| `SOC_ALERT_WEBHOOK_SECRET`                    | SOC alert signature                   | No                                              | none                                          |
| Org API keys (`terk_*`)                       | Per-tenant                            | Yes — issued + revoked per key                  | `api_key.rotated`                             |

---

## QR_SECRET (`apps/api/.env` → Cloud Run env or Secret Manager)

**Blast radius:** every existing badge QR + every magic link issued under the current secret.

The QR signer supports **dual-running rotation** via the `kid` field on v4 QRs and the `qrKidHistory` field on the event doc. Any QR signed under an old `kid` stays verifiable as long as that `kid` is in `qrKidHistory`.

### Rotation steps

1. **Pre-flight.** Confirm there are no events scheduled to start in the next 24 hours that haven't yet had badges issued. (Badges issued under the new key can't be verified by staff devices that haven't pulled the latest event doc.)
2. **Generate** the new key:
   ```bash
   openssl rand -hex 32  # 64-char hex; ≥ 32 chars enforced by config
   ```
3. **Stage** the new value in Secret Manager:
   ```bash
   gcloud secrets versions add QR_SECRET --data-file=- <<<"<new-value>"
   ```
4. **Promote** by redeploying Cloud Run — the existing service config already binds `QR_SECRET` to the latest version of the secret.
   ```bash
   gcloud run services update teranga-api --region=europe-west1 \
     --update-secrets=QR_SECRET=QR_SECRET:latest
   ```
5. **Add the new `kid`** to every active event's `qrKidHistory`. Use the admin job:
   ```
   POST /v1/admin/jobs/run { "name": "rotate-qr-kid", "args": { "newKid": "<kid>" } }
   ```
   The job appends the new `kid` to each active event and emits `event.qr_key_rotated` per event. Ops dashboards can watch the audit grid filter on this action to confirm coverage.
6. **Verify.** Issue a test badge via the back-office; scan it on staff app; observe `kid: <new>` in the QR payload + a successful scan.
7. **Hold** the old `kid` in `qrKidHistory` for at least 30 days (the longest legitimate gap between badge issue and event start). After 30 days, run the cleanup job:
   ```
   POST /v1/admin/jobs/run { "name": "prune-qr-kid", "args": { "olderThanDays": 30 } }
   ```

### Magic-link coupling

Magic-link tokens are HMAC-SHA256 with `QR_SECRET` as the key (see `O10-TEMPLATES-COORG-MAGIC-LINKS.md:137`). Rotation invalidates every outstanding magic link. Until the magic-link service migrates to its own secret (P5 follow-up), schedule rotations during low-magic-link-traffic periods.

### Emergency rotation (suspected compromise)

- Skip step 7 — leave the old `kid` out of `qrKidHistory` from step 5 onward. Every QR signed under the compromised key fails to scan immediately.
- Issue a customer comms via the audit log + the platform-wide notification banner: "We've rotated badge keys; please re-issue any pre-printed badges".

---

## PAYDUNYA_MASTER_KEY / PRIVATE_KEY / TOKEN

**Blast radius:** every payment transaction.
**Dual-running:** **NOT supported** — PayDunya only honours one key triplet at a time.

### Rotation steps

1. **Coordinate with the PayDunya merchant dashboard.** Generate a new key triplet there. The new triplet becomes active the moment you save it; old keys go cold.
2. **Stage** all three values in Secret Manager simultaneously:
   ```bash
   gcloud secrets versions add PAYDUNYA_MASTER_KEY --data-file=-
   gcloud secrets versions add PAYDUNYA_PRIVATE_KEY --data-file=-
   gcloud secrets versions add PAYDUNYA_TOKEN --data-file=-
   ```
3. **Promote** atomically by redeploying Cloud Run. The deploy workflow wires the secret bindings; a single `gcloud run services update --update-secrets=...` flips all three to the new version.
4. **Verify** by triggering a sandbox checkout (admin tool: `POST /v1/admin/jobs/run --name=paydunya-self-test`).

### Emergency rotation

- The PayDunya merchant dashboard supports an immediate revocation. Trigger it the moment compromise is suspected. Outbound payments will fail until step 3 lands; in-flight webhook signatures will return `payment.tampering_attempted` (acceptable — the audit catches the gap).

---

## WHATSAPP_APP_SECRET

**Blast radius:** Meta delivery webhook signature verification.
**Dual-running:** NOT supported by Meta.

### Rotation steps

1. **Generate** a new app secret in the Meta App Dashboard.
2. **Stage** in Secret Manager:
   ```bash
   gcloud secrets versions add WHATSAPP_APP_SECRET --data-file=-
   ```
3. **Promote** via redeploy.
4. **Verify** by triggering a test send + observing the delivery webhook return 200 (signature OK).

In-flight webhooks signed with the OLD secret will return 4xx until the new value lands. The `payment-webhook-failure.yaml` alert covers this surface; expect a brief alert spike during rotation.

---

## RESEND_API_KEY

**Blast radius:** outbound email. Bulk sends fail until the new key reaches Cloud Run.

### Rotation steps

1. **Generate** a new API key in the Resend dashboard.
2. **Update** the GitHub repo secret `RESEND_API_KEY`. The deploy workflow will (a) write it to Secret Manager and (b) bind it to Cloud Run on the next deploy.
3. **Trigger** a deploy:
   ```bash
   gh workflow run deploy-staging.yml      # then deploy-production.yml after staging verified
   ```
4. **Revoke** the old key in the Resend dashboard.

The Cloud Functions resend webhook handler uses a separate `RESEND_WEBHOOK_SECRET` Secret Manager entry — rotate that independently with the same pattern.

---

## WEBHOOK_SECRET (= PAYMENT_WEBHOOK_SECRET)

**Blast radius:** payment-provider webhook authentication. Same posture as `WHATSAPP_APP_SECRET` — no dual-running, hard cutover, brief alert spike expected.

### Rotation steps

1. **Generate** a new value: `openssl rand -hex 32`.
2. **Coordinate with each payment provider** (PayDunya, Wave, Orange Money) — every provider with a configured webhook needs the new value before the cutover. PayDunya: dashboard → Webhooks → rotate. Wave / OM: contact support.
3. **Stage** in Secret Manager + redeploy.
4. **Verify** by triggering a sandbox webhook on each provider.

---

## NEWSLETTER_CONFIRM_SECRET / UNSUBSCRIBE_SECRET

**Blast radius:** every outstanding pending-confirmation token (newsletter signups not yet confirmed) / every emailed unsubscribe link respectively.

Tokens are stateless HMAC-SHA256 — rotation invalidates every outstanding link. For `UNSUBSCRIBE_SECRET` this is an immediate compliance + deliverability event because the legally-required List-Unsubscribe link will 410 in already-shipped emails. **Coordinate with operations channel before rotating** these in production.

### Rotation steps

1. **Generate** the new secret: `openssl rand -hex 32`.
2. **Stage** in Secret Manager.
3. **Notify** the operations channel: a future flight of emails will land with valid links; emails already in inboxes will have stale links.
4. **Promote** via redeploy.
5. **Verify** by sending yourself a test unsubscribe email + clicking the link.

---

## METRICS_AUTH_TOKEN

**Blast radius:** Prometheus scrape only. Rotation has no user-facing impact.

### Rotation steps

1. Generate: `openssl rand -hex 32`.
2. Update the Cloud Run env var:
   ```bash
   gcloud run services update teranga-api --update-env-vars=METRICS_AUTH_TOKEN=<new>
   ```
3. Update the Cloud Monitoring scrape config to send the new token.

The `/metrics` endpoint will reject the old token immediately; expect a brief gap on the api-overview dashboard until the scrape config catches up.

---

## SOC_ALERT_WEBHOOK_SECRET

**Blast radius:** SOC integration. Same posture as `METRICS_AUTH_TOKEN` — out-of-band rotation, no user-facing impact.

---

## Organization API keys (`terk_*`)

**Blast radius:** one org's integrations only. Per-key + per-org.

### Rotation steps

The platform supports rotation as a first-class operation. From the back-office:

1. Issue a new key (org admin → Organization → API keys → Issue).
2. Hand the plaintext to the integrator out-of-band; the platform never re-displays it.
3. Wait for the integrator to roll over.
4. Revoke the old key (same UI). The audit row `api_key.revoked` captures the action.

---

## Quarterly drill schedule

| Month | Secret(s)                                                       |
| ----- | --------------------------------------------------------------- |
| Q1    | `QR_SECRET` + `WEBHOOK_SECRET`                                  |
| Q2    | `PAYDUNYA_*` triplet + `RESEND_API_KEY`                         |
| Q3    | `WHATSAPP_APP_SECRET` + `METRICS_AUTH_TOKEN`                    |
| Q4    | `NEWSLETTER_CONFIRM_SECRET` + `UNSUBSCRIBE_SECRET` (with comms) |

Each drill: rotate in staging first, hold 24 hours, observe the dashboard + alert YAMLs for noise, promote to production. Capture the run in `docs/runbooks/scheduled-ops.md` post-mortem template.

---

## Post-rotation audit

After every rotation, confirm via `/admin/audit`:

- The relevant audit action emitted (`event.qr_key_rotated`, `api_key.rotated`).
- No `payment.tampering_attempted` entries beyond the expected cutover spike.
- `notification.bounce_rate_alert` did not fire (Resend rotation specifically).
