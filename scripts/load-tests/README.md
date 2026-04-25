# Load tests

_Sprint-3 T4.5 closure._

[k6](https://k6.io)-based load tests for the admin back-office. Run
them before any release that ships changes to admin GET surfaces
and as part of the production-launch checklist
(`docs/runbooks/production-launch.md` step 4).

## Quick start

```bash
# Local dev API (requires the dev server + emulators running)
ADMIN_TOKEN=<firebase-id-token> k6 run scripts/load-tests/admin.js

# Staging
ADMIN_TOKEN=$STAGING_ADMIN_TOKEN \
BASE_URL=https://staging-api.teranga.events \
  k6 run scripts/load-tests/admin.js
```

## How to obtain an `ADMIN_TOKEN`

The fastest path is to log into the back-office in a browser, open
DevTools, and copy the `Authorization: Bearer …` header from any
admin API request. Tokens last 1 h — refresh by re-logging.

In CI, mint a custom token via the Firebase Admin SDK using a
service account that holds `super_admin` role.

## Thresholds

The script fails the run if any of the following thresholds is
breached:

| Endpoint | p95 budget | Notes |
|---|---|---|
| Global `http_req_duration` | p95 < 500 ms, p99 < 1 s | Industry baseline |
| `/admin/inbox` | < 800 ms | 11 parallel Firestore counts — heavier |
| `/admin/users`, `/admin/organizations`, `/admin/events` | < 500 ms | Standard list endpoints |
| `/admin/audit-logs` | < 500 ms | Fast path (no search) |
| `/admin/revenue` | < 700 ms | Sums across subscriptions |
| `/admin/usage/firestore` | < 700 ms | Aggregates last-N-day usage |
| Error rate | < 1% | Any 5xx is a fail |

Adjust thresholds when tuning post-incident; record the new
baseline in this README so the next run knows what "green" looks
like.

## What this DOESN'T cover

- **Mutations.** Bulk admin actions (suspend / verify / cancel) are
  not load-tested here — they require an isolated test project.
  Tracked as a separate suite (`mutations.js`) when we have a
  dedicated load-test environment.
- **Public API.** Participant-facing endpoints
  (`/v1/events`, `/v1/registrations`) need their own scenario
  with realistic registration flows. Tracked separately.
- **Long sessions.** This suite is a 4-minute burst. Soak testing
  (multi-hour) requires GCP scheduling.

## CI integration

Manual today: run from a workstation, paste the summary into the
release PR. Future automation: a `workflow_dispatch` GitHub Action
that lifts `STAGING_ADMIN_TOKEN` from secrets and runs the suite
against the latest staging deployment.
