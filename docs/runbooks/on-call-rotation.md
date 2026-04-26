# Runbook — On-call rotation

> **Wave 10 / W10-P5 / L5.** Defines how the on-call rotation is structured, who pages whom, and what hand-over looks like.
> Linked from `docs/runbooks/production-launch.md` § Pre-launch checklist.

---

## Rotation shape

| Tier                  | Coverage     | Response SLO              | Rotation cadence                           |
| --------------------- | ------------ | ------------------------- | ------------------------------------------ |
| Primary               | 24 / 7       | 15 min ack, 30 min triage | 1 week, Monday → Monday 09:00 Africa/Dakar |
| Secondary             | 24 / 7       | 30 min ack                | 1 week, offset 4 days from primary         |
| Tertiary (escalation) | Office hours | 1 h                       | Engineering lead, on-call lead             |

**Coverage windows:** 24/7 because Senegal-based events span weekends and the participant funnel never sleeps. African-network conditions plus the offline-first mobile fallback mean an outage in Dakar at 03:00 still costs a real organiser the morning's check-in.

**Hand-over ritual:** Every Monday at 09:00 the outgoing primary writes a 5-bullet hand-over note in the `#on-call-handover` channel covering:

1. Active incidents (open or resolved < 7 days).
2. Post-mortems pending action items they own.
3. Outstanding page noise / alert fatigue concerns.
4. Upcoming high-traffic events on the platform calendar.
5. Any service-impacting deploys planned in the incoming week.

The incoming primary acknowledges with a thumbs-up; if the hand-over is missed, the secondary escalates within 1 hour.

---

## Page paths

### PagerDuty service: `teranga-prod`

| Alert source                                                   | Routes to                |
| -------------------------------------------------------------- | ------------------------ |
| Cloud Monitoring `api-5xx-rate.yaml` (P0)                      | `teranga-prod` → primary |
| Cloud Monitoring `ready-probe-failure.yaml` (P0)               | `teranga-prod` → primary |
| Cloud Monitoring `payment-webhook-failure.yaml` (P0)           | `teranga-prod` → primary |
| Cloud Monitoring `api-latency-p95.yaml` (P1)                   | Slack `#prod-incidents`  |
| Cloud Monitoring `notification-bounce-rate-critical.yaml` (P0) | `teranga-prod` → primary |
| Cloud Monitoring `notification-bounce-rate-warn.yaml` (P1)     | Slack `#prod-incidents`  |
| Sentry "issue spike" alert (P0)                                | `teranga-prod` → primary |
| Sentry "regression" alert (P1)                                 | Slack `#prod-incidents`  |

The four W10-P3 alert YAMLs in `infrastructure/monitoring/` ship with empty channel lists; the production deploy workflow injects the per-env channel ids on every deploy via `gcloud alpha monitoring policies update --add-notification-channels=...`.

### Slack channels

| Channel             | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `#prod-incidents`   | P1 alerts + status updates during a live incident             |
| `#on-call-handover` | Weekly hand-over notes                                        |
| `#postmortems`      | Read-only: published post-mortems for the team                |
| `#prod-deploys`     | Cloud Run / Firebase Hosting / Functions deploy notifications |

---

## Escalation tree

```
            Primary (15 min ack)
                  │ 30 min, no progress
                  ▼
            Secondary (30 min ack)
                  │ 30 min, no progress
                  ▼
        Engineering lead (call)
                  │ 30 min, P0 only
                  ▼
            CTO / on-call lead
                  │ if customer-impacting > 2 h
                  ▼
        GCP support: 1-844-613-7589  (premier support id: <PREMIER-ID>)
                  │ if Firestore / Cloud Run platform issue
                  ▼
        Public status page update
```

`<PREMIER-ID>` lives in the team password manager; ops on-call has read access.

---

## Severity matrix (used by the page receiver)

| Severity | Examples                                                                                 | Response                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **SEV1** | Platform-wide outage, data loss, payment integration down, security incident in progress | Page primary + secondary IMMEDIATELY, status page update within 30 min, post-mortem within 5 business days |
| **SEV2** | Single-tenant outage, scoped feature down, 5xx rate ≥ 1 %, latency p95 > 1.5 s sustained | Page primary, status page update within 60 min, post-mortem within 10 business days                        |
| **SEV3** | Non-critical regression, deferred fix acceptable                                         | Slack notification only, fix in next sprint                                                                |
| **SEV4** | Cosmetic / docs / non-customer-impacting                                                 | Slack notification only, regular backlog                                                                   |

The `incident-response.md` runbook covers the SEV1 / SEV2 procedure end-to-end.

---

## On-call equipment

Each on-call engineer carries:

- Laptop with `gcloud`, `firebase`, `gh`, and the Teranga repo cloned + clean.
- Sufficient battery / charger / cellular hotspot (the Dakar data centres can be reached via cellular when residential fibre drops).
- Access to the team password manager (1Password vault `teranga-prod`).
- PagerDuty mobile app installed + push notifications NOT muted.

---

## Hand-over checklist (incoming primary)

```
[ ] Read this week's #on-call-handover note
[ ] gcloud auth login + gcloud config set project teranga-events-prod
[ ] firebase use production
[ ] Pull latest develop + main locally
[ ] Confirm PagerDuty schedule shows me as primary
[ ] Confirm Sentry shows my email as project owner / responder
[ ] Confirm Slack #prod-incidents notifications are unmuted
[ ] Verify incident-response.md is bookmarked
[ ] Verify Cloud Monitoring dashboards are bookmarked:
      - api-overview.json
      - notification-deliveries.json
[ ] Block off any meeting > 1 h that I can't drop on a SEV1 page
```

---

## Drills

Quarterly fire-drill — primary + secondary run a synthetic SEV2 scenario end-to-end. Document the timing in `scheduled-ops.md`. Drills are mandatory; missing one rotates the engineer off the active list until they catch up.
