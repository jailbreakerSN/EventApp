# Runbook — Incident response

> **Wave 10 / W10-P5 / L5.** End-to-end procedure for a SEV1 / SEV2 incident on the Teranga production platform.
> Pairs with `docs/runbooks/on-call-rotation.md` (who) and `docs/runbooks/production-launch.md` (deploy controls).

This runbook is the single source of truth during an incident. **Do not freelance — follow the steps in order.** If a step breaks, document why in the incident channel and continue.

---

## Step 1 — Acknowledge (within 15 min for SEV1)

1. Click "ack" in PagerDuty / Slack. Stop the page from re-firing.
2. Open `#prod-incidents` and post:
   ```
   ack — <your name> on it. Investigating <alert title>.
   ```
3. Open the linked Cloud Monitoring alert + the Cloud Run service detail page.

---

## Step 2 — Triage (within 30 min for SEV1)

Decision tree:

| Symptom                  | First action                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 5xx rate ≥ 1 %           | Pin previous Cloud Run revision (Step 3).                                                                   |
| `/ready` failing         | Check Firestore IAM + GCP status; if recent deploy, pin previous revision.                                  |
| p95 latency spike        | Check `dashboards/api-overview.json` for which route is slow; check Cloud Run instance count + concurrency. |
| Payment webhook 4xx      | Check `payment.tampering_attempted` audit rows; verify provider HMAC secret per `secret-rotation.md`.       |
| Sentry issue spike       | Check the top issue; categorise as code regression vs config drift.                                         |
| Notification bounce rate | See `docs/notifications/alerting.md` § Bounce-rate alert.                                                   |

**If the cause is not obvious within 30 min, declare SEV1** and escalate to the secondary + post a status-page update.

---

## Step 3 — Mitigate

### Pin previous Cloud Run revision (rollback)

```bash
# List recent revisions:
gcloud run revisions list --service=teranga-api --region=europe-west1 --limit=10

# Route 100% of traffic to a known-good revision:
gcloud run services update-traffic teranga-api --region=europe-west1 \
  --to-revisions=teranga-api-<known-good-revision>=100
```

The pin is **immediate** — Cloud Run shifts traffic at the load balancer. Verify `/ready` returns 200 within 60 seconds.

### Disable a feature behind a feature flag

Super-admin → Feature flags → toggle off. Cached on edge for ≤ 30 s. Use this for any feature whose blast radius is bounded (e.g. WhatsApp opt-in, magic-link issuance).

### Kill switch — API key auth

If org API keys (`terk_*`) are implicated, set the kill-switch:

```bash
gcloud run services update teranga-api --update-env-vars=API_KEY_AUTH_DISABLED=true
```

All `terk_*` requests will 401 immediately. Firebase ID-token auth keeps working.

### Throttle a route

Add a tighter `config.rateLimit` in code, deploy hotfix branch. Last resort — only if the rate-limit middleware itself is the safety net of last resort.

---

## Step 4 — Communicate

| Audience            | Channel                                       | Cadence                                                             |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| Internal team       | `#prod-incidents`                             | Every 15 min while incident is open                                 |
| Customers           | Status page (`status.teranga.events`)         | Initial post within 30 min; updates every 30 min                    |
| Affected organisers | Direct email via `support@terangaevent.com`   | Within 1 h of confirmed customer impact                             |
| Regulators          | Senegal CDP via `compliance@terangaevent.com` | Within 72 h IF the incident is a personal-data breach (Loi 2008-12) |

Status-page template (incident OPEN):

```
TITLE: <one-sentence symptom>
STATUS: investigating | identified | monitoring | resolved
IMPACT: <which surfaces, which orgs>
ETA: <if known; "investigating" otherwise>
```

Status-page template (incident RESOLVED):

```
TITLE: [Resolved] <symptom>
DURATION: <start ISO> → <end ISO> (<n> min)
ROOT CAUSE: <one-paragraph plain-language>
NEXT STEPS: post-mortem will be posted within <SLA per severity>
```

---

## Step 5 — Resolve

1. Verify the alert auto-closed (Cloud Monitoring policies have a 30-min auto-close after the metric returns to normal — see `infrastructure/monitoring/*.yaml`).
2. Post the RESOLVED template on the status page.
3. Move `#prod-incidents` thread to read-only mode by replying with the resolution summary.
4. Open a post-mortem doc (template at `docs/runbooks/postmortem-template.md` — TODO: ship in Wave 10 P6 follow-up).

---

## Step 6 — Post-mortem (within 5 / 10 / N business days per severity)

The post-mortem is **blameless**. Cover:

- **Timeline.** UTC + Africa/Dakar timestamps for every observable event.
- **Root cause.** Why this could happen. Not "who did what".
- **Detection.** How long did it take to ack? Was the page actionable? Did the dashboard help?
- **Mitigation.** What did we do, in order? What worked, what didn't?
- **Lessons.** Three to five concrete action items, each owned by a named engineer with a due date.

Publish in `#postmortems` and link from `docs/runbooks/postmortems/`.

---

## SEV1 quick-reference card

```
  ┌─ 0 min ─────────────────────────────┐
  │ ack PagerDuty + post in #prod-      │
  │ incidents (template above)          │
  └───────────┬─────────────────────────┘
              │
  ┌─ 15 min ──▼─────────────────────────┐
  │ Triage. If unclear, ESCALATE to     │
  │ secondary + open status page.       │
  └───────────┬─────────────────────────┘
              │
  ┌─ 30 min ──▼─────────────────────────┐
  │ Mitigate (pin revision OR kill-     │
  │ switch OR feature-flag toggle).     │
  │ Status update.                      │
  └───────────┬─────────────────────────┘
              │
  ┌─ 60 min ──▼─────────────────────────┐
  │ If still SEV1, customer email +     │
  │ engineering lead pulled in.         │
  └───────────┬─────────────────────────┘
              │
  ┌─ Resolve ─▼─────────────────────────┐
  │ Auto-close alert, status page       │
  │ resolved, schedule post-mortem.     │
  └─────────────────────────────────────┘
```

---

## Specific scenarios

### "API is throwing FIRESTORE_INDEX_MISSING in production"

The error handler in `apps/api/src/app.ts:289-345` translates Firestore `FAILED_PRECONDITION` into `FIRESTORE_INDEX_MISSING`. The log carries `firestoreIndexUrl` — the Firebase console quick-create link.

1. Click the URL — Firebase will create the index in 5–15 min.
2. Add the index to `infrastructure/firebase/firestore.indexes.json` and merge into `develop` so subsequent staging redeploys are idempotent. The `audit:firestore-indexes:strict` step will pass once the file matches.
3. While the index builds, the affected route returns 500. Pin the previous Cloud Run revision if the route was working before the deploy.

### "Sentry shows a flood of `notification.bounce_rate_alert`"

Resend mailbox provider rejected ≥ 2 % of sends from a domain. See `docs/notifications/alerting.md`. Most common cause: SPF / DKIM / DMARC drift after a DNS change, OR a sudden flood of invalid addresses imported by an organiser. Pause the affected `EmailCategory` in the admin notification settings while investigating.

### "Magic-link verify is returning 410"

Either (a) tokens are expired (TTL exceeded — expected) or (b) `QR_SECRET` was rotated and `qrKidHistory` doesn't carry the old `kid`. Check `secret-rotation.md` § QR_SECRET and add the old `kid` back to `qrKidHistory` if rotation was unintentional.

### "Web backoffice is blank"

Almost always a client-side JS error. Check Sentry for `web-backoffice` issues. If the Sentry SDK itself fails to init (e.g. CSP blocks the ingest URL), check the latest `csp-violation` reports for a `connect-src` violation against `*.sentry.io`.

### "WhatsApp sends are failing"

- Meta Business Manager → check the app's status; sometimes Meta blocks an app over policy.
- `payment-webhook-failure.yaml`-style alert? Check `WHATSAPP_APP_SECRET` rotation drift.
- `whatsappOptIns` collection writes failing? The W10-P2 Firestore rules block all client writes — confirm the API path is the only writer.

---

## Red lines (DO NOT)

- **Never** push directly to `main` to fix an incident. Hotfix branch → release PR with engineering-lead approval. Even SEV1.
- **Never** delete Firestore docs to "clean up" a corrupt state. Soft-delete via the admin tool; preserve the audit trail.
- **Never** disable a security control (CSP, rate-limit, IP allowlist) to mitigate. They exist to bound blast radius; disabling them during an incident expands it.
- **Never** silence a Cloud Monitoring alert without filing a post-incident note explaining why.
