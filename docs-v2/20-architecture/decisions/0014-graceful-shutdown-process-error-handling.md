# ADR-0014: Graceful shutdown + process-level error handling

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

The Fastify API runs on Cloud Run. Cloud Run lifecycle:

1. Receives `SIGTERM` when an instance is being recycled (deploy, autoscaling down, infrastructure migration).
2. Has 10 seconds to drain before `SIGKILL`.
3. May receive an `unhandledRejection` (a Promise rejected without a `.catch`) — usually a code bug.
4. May receive an `uncaughtException` — usually unrecoverable (stack corruption, native crash).

Default Node.js behavior:

- `unhandledRejection` → warning printed, then the process keeps running. Can mask real bugs.
- `uncaughtException` → process exits with code 1. Loses in-flight requests.
- `SIGTERM` → process exits immediately. In-flight HTTP requests are dropped, returning 502 to clients.

For a public-facing API serving event check-ins (where a 502 mid-scan is a bad UX moment), this is unacceptable.

---

## Decision

**The API installs explicit handlers for `SIGTERM`, `SIGINT`, `unhandledRejection`, and `uncaughtException` — `SIGTERM`/`SIGINT` drain gracefully; both unhandled-error events log + crash so Cloud Run restarts the instance:**

```typescript
// SIGTERM / SIGINT: graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, draining...');
  await fastify.close();      // stops accepting new connections, drains in-flight
  process.exit(0);
});

// unhandledRejection: log + crash (running in undefined state is worse
// than restarting — Sentry gets a 1-second flush window before exit).
process.on('unhandledRejection', (reason) => {
  captureError(reason, { source: 'unhandledRejection' });
  logger.fatal({ err: reason }, 'Unhandled promise rejection — crashing');
  closeSentry(1000).finally(() => process.exit(1));
});

// uncaughtException: same crash policy as unhandledRejection.
process.on('uncaughtException', (err) => {
  captureError(err, { source: 'uncaughtException' });
  logger.fatal({ err }, 'Uncaught exception — crashing');
  closeSentry(1000).finally(() => process.exit(1));
});
```

Cloud Run's deployment config gives the container 10s grace before `SIGKILL`. Fastify's `close()` resolves once all in-flight requests complete. The "crash on unhandled error" policy intentionally errs on the side of restart — Cloud Run respawns within seconds, and a fresh process is safer than running with a known-broken Promise chain or corrupted call stack.

---

## Reasons

- **No 502s on deploys.** SIGTERM-triggered drain ensures the load balancer can route new requests elsewhere while in-flight ones complete.
- **Crash-on-unhandled-error is the safer default.** A `unhandledRejection` or `uncaughtException` means the runtime invariants we rely on may no longer hold (a Promise chain silently dropped, a stack frame corrupted, a resource leaked). Cloud Run respawns the instance within seconds; that beats running on with subtly broken state.
- **Sentry gets a flush window.** Both handlers call `closeSentry(1000)` before exit so the crash event itself reaches the error tracker — otherwise the alert that should fire is the one we'd lose.
- **Distinguishing signal-from-error is standard Node.js practice.** Node.js docs ("Don't ignore errors") + Cloud Run's recycling lifecycle both push toward this split.
- **Observability.** Every crash logs `level: fatal` with the error stack + a `source` field (`unhandledRejection` or `uncaughtException`). Cloud Logging alert routes `level=fatal` to PagerDuty.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Default Node.js behavior | Drops in-flight requests on deploy → 502s. |
| Log + keep running on `unhandledRejection` | Node.js's previous default. Masks real bugs and leaves the process in unknown state. Cloud Run respawn is cheap; keeping a half-broken process is not. |
| Don't shut down on `uncaughtException` | Unsafe — process state is unknown. Could yield silent data corruption. |
| Use a process supervisor (PM2) | Cloud Run is the supervisor. Adding PM2 layers conflicts with Cloud Run's lifecycle. |

---

## Conventions

- **Health probes** distinguish liveness from readiness:
  - `/health` — always returns 200 (liveness, used by Cloud Run to detect "is the process alive?").
  - `/ready` — checks Firestore connectivity (readiness, used by load balancer to gate traffic).
- **Drain order on SIGTERM:** Fastify close → Firestore terminate → process exit. Reversing breaks in-flight requests.
- **Event listeners drain on shutdown.** If a listener has work in flight, it has up to 10s to finish.
- **Background tasks scheduled via `setImmediate` / `setTimeout`** must check a shutdown flag before running.

---

## Consequences

**Positive**

- Zero-downtime deploys on Cloud Run.
- Loud crash on `unhandledRejection` / `uncaughtException` — every error reaches Sentry and Cloud Logging.
- Clear semantic distinction between operator signals (drain) and runtime errors (crash + restart).
- Cloud Run health probes route traffic correctly during startup and shutdown.

**Negative**

- Drain takes up to 10s — slow long-running requests are killed at SIGKILL. Mitigated: API requests are sub-second; long jobs run in Cloud Functions / scheduled jobs.
- A bug that throws on every request will crash-loop. Cloud Run will back off and surface the failure rate in monitoring; PagerDuty fires on `level=fatal`. Acceptable trade-off vs. silently running broken state.
- Test coverage for shutdown handlers requires process-level mocks. Skipped at the unit level; covered by integration smoke tests.

**Follow-ups**

- Cloud Logging alert rules — owned by ops, defined in `infrastructure/terraform/` (planned).
- Per-listener shutdown hooks (currently relies on Fastify's drain) — only needed if listeners take long-running async work.

---

## References

- `apps/api/src/index.ts` — signal handlers, drain logic, `unhandledRejection` + `uncaughtException` crash policy.
- `apps/api/src/routes/health.routes.ts` — `/health` + `/ready`.
- `apps/api/src/lib/sentry.ts` — `captureError()` + `closeSentry()` flush helper.
- Node.js docs: [Don't ignore errors](https://nodejs.org/api/process.html#event-uncaughtexception).
- Cloud Run lifecycle: 10s grace period, SIGTERM then SIGKILL.
- CLAUDE.md → "Backend Design Principles" §5–6 (note: CLAUDE.md §6 still describes the older "log + keep running" `unhandledRejection` policy and is out of date relative to this ADR; the code matches the ADR).
