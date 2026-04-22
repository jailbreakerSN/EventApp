# Notification Alerting (Phase 2.5)

Operators get two complementary surfaces for notification-delivery health:

1. **Durable alert documents** under `alerts/notification-bounce-rate/events/`
   — one doc per (domain, window) that crossed a threshold. The admin UI
   reads this collection to build the observability dashboard.
2. **Cloud Logging entries** at ERROR severity, emitted by the scheduled
   `monitorBounceRate` Cloud Function. Log-based Alerting Policies
   subscribe to these to page operators via PagerDuty / Slack / email.

Both surfaces are produced by
`apps/functions/src/triggers/notification-health.triggers.ts`.

---

## Thresholds

| Severity | Threshold   | Action                                                                               |
| -------- | ----------- | ------------------------------------------------------------------------------------ |
| `warn`   | bounce ≥ 2% | Investigate within 4 h — likely the start of a reputation dip.                       |
| `critical` | bounce ≥ 5% | Page on-call immediately — Gmail/Yahoo will start deferring or rejecting outright. |

The rate is computed over a rolling 1 h window with `bounced + complained
/ (sent + delivered + bounced + complained)`. Suppressions for other
reasons (admin_disabled, user_opted_out) are excluded from the
denominator — they're not deliverability signals.

## Per-domain scoping

We alert separately per sending mailbox because reputation is domain-
scoped. A bounce storm on `news@` (marketing) must not suppress alerts
for `events@` (transactional). The mapping lives inline in the trigger
file; update there whenever a new catalog key is added.

| Mailbox (RESEND_FROM_\*) | Category tag                 |
| ------------------------ | ---------------------------- |
| events@                  | auth, transactional          |
| hello@                   | organizational               |
| billing@                 | billing                      |
| news@                    | marketing                    |

## Log-based Alerting Policy (GCP console template)

Create once per environment. Staging uses the `warn` threshold only,
production wires both thresholds to separate channels.

**Log filter:**

```
severity="ERROR"
resource.type="cloud_function"
resource.labels.function_name="monitorBounceRate"
jsonPayload.message="notification.bounce_rate_alert"
jsonPayload.severity="critical"
```

**Alert trigger:** Any matching log line in a 5 min window.

**Notification channels:**

- Critical → PagerDuty (on-call rotation).
- Warn → Slack `#notifications-ops` channel.

The jsonPayload carries `domain`, `rate`, `bounceCount`, `totalCount`,
`windowStart`, and `windowEnd` so runbooks can link directly into the
admin observability dashboard filtered to the correct key group.

## Runbook (on page)

1. Check the admin UI at `/admin/notifications/delivery` — which keys are
   driving the bounces?
2. Pull a sample of bouncing addresses via the dispatch-log view. If
   they're a single tenant, the issue is content-specific; if they span
   tenants, it's reputation.
3. Pause the corresponding catalog key (admin override → enabled=false)
   while you investigate. Auth + billing keys cannot be paused — you'll
   need to rotate through the suppression list.
4. If the Resend dashboard shows a spike in a specific error code (e.g.
   `550 5.7.1 Blocked`), open a deliverability ticket with Resend and
   reference the affected domain + timeframe.

## Self-service

The same per-domain aggregation will eventually land in the web-
backoffice observability dashboard (Phase 2.4). Until then, operators
query `alerts/notification-bounce-rate/events/` directly in the
Firestore console.
