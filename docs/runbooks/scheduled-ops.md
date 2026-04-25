# Runbook — Scheduled admin operations

_Sprint-4 T3.2 closure._

Defines how recurring runs of registered admin jobs work, plus the
infra setup that drives the wake-up cycle.

## TL;DR

| What | Where |
|---|---|
| **Create a recurring job** | `/admin/scheduled-ops` → "Nouvelle opération" |
| **Pause without deleting** | toggle the row's switch |
| **See past runs** | `/admin/jobs` (filter by jobKey) |
| **Wake-up cadence** | Cloud Functions trigger, every 5 min |

## Architecture

```
+-------------------+         +----------------+         +----------------+
| Operator UI       |  CRUD   | scheduledAdminOps |  read   | Cloud Functions |
| /admin/scheduled-ops | ────► | (Firestore)    | ◄────── | scheduled trigger |
+-------------------+         +----------------+         | (every 5 min)  |
                                                          +-------+--------+
                                                                  │ POST
                                                                  ▼
                                                          +----------------+
                                                          | Admin Job runner|
                                                          | (existing)     |
                                                          +----------------+
```

The operator defines the schedule + job key + frozen input from the
back-office. A Cloud Functions scheduled trigger wakes up every 5
minutes, queries `scheduledAdminOps WHERE enabled=true AND
nextRunAt <= now`, and dispatches each match into the existing
admin job runner. After each run the trigger updates `lastRunAt`,
`lastRunStatus`, `lastRunRunId`, and computes the next `nextRunAt`
from the cron expression.

Why we built it this way:
- **Cloud Scheduler caps at ~10k jobs** and requires IaC per job.
  Storing schedules in Firestore lets operators add new ones from
  the back-office without an infra change.
- **5-minute granularity** is the trigger's wake-up interval. For
  ops measured in hours/days this is fine; sub-minute granularity
  is YAGNI for operator-driven schedules.
- **Frozen jobInput** at op-creation time. The handler's input
  schema is re-validated on every UPDATE so a handler refactor
  catches stale ops.

## Setting up the wake-up trigger (one-time)

The trigger lives in `apps/functions/src/triggers/scheduled-ops.scheduled.ts`
(NOT included in this MVP — backend service + UI shipped first).

When you wire it, follow this contract:

1. **Trigger definition** — Cloud Functions v2 scheduled trigger, region `europe-west1`, schedule `every 5 minutes`, retryConfig `retryCount: 3`.

2. **Handler logic** — pseudo-code:
   ```ts
   const now = new Date().toISOString();
   const dueOps = await db.collection("scheduledAdminOps")
     .where("enabled", "==", true)
     .where("nextRunAt", "<=", now)
     .limit(50)
     .get();

   for (const doc of dueOps.docs) {
     const op = doc.data();
     const handler = getHandler(op.jobKey);
     if (!handler) {
       // The handler was unregistered between create-time and
       // runtime. Disable the op + log.
       await doc.ref.update({ enabled: false, lastRunStatus: "failed" });
       continue;
     }
     // Dispatch via the existing admin job runner. Re-uses the
     // single-flight lock + audit + notification fan-out.
     try {
       const runId = await adminJobsService.run(op.jobKey, op.jobInput, /* system actor */);
       await doc.ref.update({
         lastRunAt: new Date().toISOString(),
         lastRunRunId: runId,
         lastRunStatus: "running", // updated to terminal state by the run completion hook
         nextRunAt: nextCronRun(op.cron, new Date(), op.timezone),
       });
     } catch (err) {
       await doc.ref.update({
         lastRunAt: new Date().toISOString(),
         lastRunStatus: "failed",
         nextRunAt: nextCronRun(op.cron, new Date(), op.timezone),
       });
     }
   }
   ```

3. **System actor** — the trigger must impersonate a "system"
   AuthUser with `super_admin` role so the job runner's permission
   gate accepts the call. Mint a system user once via the
   `bootstrap-system-actor.ts` script (separate, not in this MVP).

## Common ops

### Auto-archive completed events

```json
{
  "name": "Auto-archive — events terminés > 90j",
  "jobKey": "auto-archive-completed-events",  // future job
  "cron": "0 3 * * *",
  "timezone": "Africa/Dakar",
  "jobInput": { "minDaysSinceEnd": 90 }
}
```

### Daily Firestore backup

```json
{
  "name": "Backup quotidien",
  "jobKey": "firestore-backup",
  "cron": "0 2 * * *",
  "timezone": "Africa/Dakar",
  "jobInput": { "label": "daily" }
}
```

### J-7 payment reminder

```json
{
  "name": "Rappel J-7 — paiements en attente",
  "jobKey": "payment-d7-reminder",  // future job
  "cron": "0 9 * * *",
  "timezone": "Africa/Dakar",
  "jobInput": {}
}
```

## Failure modes

### "Unknown jobKey"

The handler was unregistered between op creation and trigger time.
The trigger disables the op and surfaces the failure in
`lastRunStatus`. Operator action: re-create the op against the new
handler key, or delete.

### "Cron produced no future fire within 366 days"

The cron expression has a constraint that never matches (e.g.
`30 14 31 2 *` — February 31). The trigger refuses to schedule;
the operator sees the validation error inline.

### Multiple triggers fire simultaneously

The job runner's existing single-flight lock (per `jobKey`) makes
concurrent triggers safe — a second wake-up that hits an in-flight
job sees the lock and skips. The op's `lastRunStatus` reflects the
latest completion.

## Related

- `apps/api/src/services/scheduled-ops.service.ts` — CRUD service
- `apps/api/src/services/cron.ts` — cron parser + nextRunAt
- `apps/api/src/jobs/registry.ts` — registered job handlers
- `docs/runbooks/backup-restore.md` — backup job semantics
