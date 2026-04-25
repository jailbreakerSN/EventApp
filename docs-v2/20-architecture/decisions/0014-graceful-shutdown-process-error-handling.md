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

**The API installs explicit handlers for `SIGTERM`, `SIGINT`, `unhandledRejection`, and `uncaughtException` with distinct semantics:**

```typescript
// SIGTERM / SIGINT: graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, draining...');
  await fastify.close();      // stops accepting new connections, drains in-flight
  await db.terminate();        // closes Firestore connection
  process.exit(0);
});

// unhandledRejection: log + keep running
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandledRejection — investigate');
  // process stays up
});

// uncaughtException: log + graceful shutdown (process state is unknown)
process.on('uncaughtException', async (err) => {
  logger.fatal({ err }, 'uncaughtException — shutting down');
  try { await fastify.close(); } catch {}
  process.exit(1);
});
```

Cloud Run's deployment config gives the container 10s grace before `SIGKILL`. Fastify's `close()` resolves once all in-flight requests complete.

---

## Reasons

- **No 502s on deploys.** SIGTERM-triggered drain ensures the load balancer can route new requests elsewhere while in-flight ones complete.
- **`unhandledRejection` does not crash.** A single missing `.catch` somewhere in a listener should not take down the API. Log loud, investigate later.
- **`uncaughtException` shuts down.** Process state is unknown after an uncaught exception (corrupted memory, dangling resources). Continuing is unsafe — exit and let Cloud Run restart.
- **Distinguishing the two** is the standard Node.js production practice (Node.js docs, "Don't ignore errors"; Joyent debugging guide).
- **Observability.** Every signal is logged with context (request ID if available, error stack, timestamp). Cloud Logging alerts trigger on `level: fatal`.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Default Node.js behavior | Drops in-flight requests on deploy → 502s. |
| Crash on `unhandledRejection` | Aggressive; a single bug in a listener takes down the whole API. |
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
- Investigatable `unhandledRejection` logs without crash loops.
- Clear semantic distinction between recoverable and unrecoverable errors.
- Cloud Run health probes route traffic correctly during startup and shutdown.

**Negative**

- Drain takes up to 10s — slow long-running requests are killed at SIGKILL. Mitigated: API requests are sub-second; long jobs run in Cloud Functions / scheduled jobs.
- `unhandledRejection` accumulating without a fix means silent failure. Mitigated by Cloud Logging alert: `count(level=error) > N per 5min` pages on-call.
- Test coverage for shutdown handlers requires process-level mocks. Skipped at the unit level; covered by integration smoke tests.

**Follow-ups**

- Cloud Logging alert rules — owned by ops, defined in `infrastructure/terraform/` (planned).
- Per-listener shutdown hooks (currently relies on Fastify's drain) — only needed if listeners take long-running async work.

---

## References

- `apps/api/src/server.ts` — signal handlers, drain logic.
- `apps/api/src/routes/health.routes.ts` — `/health` + `/ready`.
- Node.js docs: [Don't ignore errors](https://nodejs.org/api/process.html#event-uncaughtexception).
- Cloud Run lifecycle: 10s grace period, SIGTERM then SIGKILL.
- CLAUDE.md → "Backend Design Principles" §5–6.
