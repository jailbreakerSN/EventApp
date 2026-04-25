# ADR-0010: Domain event bus for side effects (notifications, audit, future webhooks)

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

Every mutation in the API has side effects:

- **Audit log entry** — every change to events, registrations, organizations, members must be recorded.
- **Notifications** — registration confirmations, badge availability, plan upgrade emails.
- **Future webhooks** — Phase 2 will let organizations subscribe to event types via HTTPS webhooks.
- **Counter updates** — registration counts, check-in counts (when not handled inside a transaction).

The naïve approach is to call each side effect inline from the service:

```typescript
// Naïve, rejected
async register(eventId: string, userId: string) {
  const reg = await this.repo.create({...});
  await this.auditService.log('registration.created', reg);
  await this.notificationService.sendConfirmation(userId);
  await this.counterService.increment(eventId);
  return reg;
}
```

Problems:

1. **Coupling.** `RegistrationService` now imports four other services. Tests need four mocks per method.
2. **Atomicity confusion.** If the audit write fails, do we fail the registration? Different side effects have different criticality.
3. **Scaling.** Adding webhooks means editing every service to dispatch them. Forgetting one is silent.
4. **Latency.** Each `await` adds round-trip time before responding to the user.

---

## Decision

**After every successful mutation, the service emits a typed domain event. Listeners subscribe at startup. Listener execution is fire-and-forget (errors logged, never propagated).**

```typescript
// Service code
async register(eventId: string, userId: string) {
  const reg = await this.repo.create({...});
  eventBus.emit('registration.created', { registrationId: reg.id, eventId, userId, ... });
  return reg;
}

// Listener registered at startup
eventBus.on('registration.created', auditListener);
eventBus.on('registration.created', notificationListener);
eventBus.on('registration.created', counterListener);
```

The bus is implemented with Node.js `EventEmitter` wrapped in a typed facade (`apps/api/src/events/event-bus.ts`). All event names and payloads are declared in `apps/api/src/events/domain-events.ts` as a discriminated union.

---

## Reasons

- **Decoupling.** Services don't know about audit, notifications, or webhooks. They only know "something happened, here's the payload".
- **Testability.** Service tests assert `eventBus.emit` was called with the right payload — no need to mock four downstream services.
- **Atomicity is explicit.** Side effects emit AFTER the mutation commits. If the bus listener fails, the mutation has already succeeded — correct semantics for audit/notifications, which must not roll back business operations.
- **Listener errors isolated.** A failing audit listener does not break notifications. Each listener catches its own errors and logs them.
- **Future webhook support is one listener away.** Phase 2 adds `webhookListener` registered for the same events — zero changes to services.
- **Latency.** The mutation responds to the user immediately; side effects run asynchronously.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Direct service-to-service calls | Coupling explosion, four mocks per service test. |
| Cloud Functions Firestore triggers | Cold starts, can't access request context (userId, requestId), harder to unit test. Used only for batch jobs (badge generation). |
| Pub/Sub topic per event type | Operational overhead for the MVP. Would re-evaluate at high scale (>1k events/sec). |
| Synchronous bus with await | Defeats the latency benefit; also breaks the "side effect failures don't roll back the mutation" property. |

---

## Conventions

- **Event name format:** `<aggregate>.<past-tense-verb>` — e.g. `registration.created`, `event.published`, `subscription.upgraded`.
- **Payload shape:** Typed in `domain-events.ts`. Always includes `aggregateId` and a request context snapshot (requestId, userId).
- **Listener side effects must be idempotent.** Listeners can be retried (planned: Phase 2 retry queue).
- **Never emit inside a transaction.** Emit AFTER `db.runTransaction()` resolves successfully — see ADR-0008 (audit trail) and CLAUDE.md.
- **Audit listener is mandatory** for every mutation. The `domain-event-auditor` agent enforces this in CI.

---

## Consequences

**Positive**

- Add a side effect = add a listener. Zero service changes.
- Service tests are simpler.
- Latency is bounded by the synchronous write; side effects are out-of-band.
- Audit coverage is tracked mechanically by the test suite (every mutation has an `eventBus.emit` assertion).

**Negative**

- Listener failures are silent unless monitored. Mitigated by structured logging + Cloud Logging-based alerts on listener error counts.
- Cannot guarantee listener completion before the API responds. Acceptable for audit/notifications; not acceptable for counters that the next read depends on (those use Firestore transactions).
- In-process bus is single-instance. Scaling out Cloud Run instances means each instance runs its own listeners — works because listeners write to Firestore (shared state) and are designed to be idempotent.

**Follow-ups**

- Persistent retry queue for listener failures (planned, Phase 2).
- Webhook delivery service (planned, Wave 4+).

---

## References

- `apps/api/src/events/event-bus.ts` — typed bus facade.
- `apps/api/src/events/domain-events.ts` — discriminated union of event names and payloads.
- `apps/api/src/events/listeners/audit.listener.ts` — audit log writer (one of several listeners under `events/listeners/`).
- `.claude/agents/domain-event-auditor.md` — CI agent that flags missing emits.
