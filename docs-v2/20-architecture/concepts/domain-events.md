# Domain Events & Audit Trail

> **Status: shipped** — The event bus and audit listener are fully implemented. 83 audit actions are defined.

---

## Why domain events?

Without an event bus, services would directly call each other for side effects:

```typescript
// ❌ Without event bus — tight coupling
async register(user, dto) {
  const reg = await this.registrationRepo.create(dto);
  await this.notificationService.sendConfirmationEmail(reg);  // coupled
  await this.auditService.log('registration.created', reg);   // coupled
  await this.planService.refreshUsage(reg.organizationId);    // coupled
  return reg;
}
```

This creates circular dependencies, makes services hard to test in isolation, and means a notification failure can roll back a successful registration.

With the event bus:

```typescript
// ✅ With event bus — decoupled
async register(user, dto) {
  const reg = await this.registrationRepo.create(dto);
  this.eventBus.emit('registration.created', { registration: reg, actor: user });
  return reg; // response is not blocked by side effects
}
```

Listeners handle the side effects independently. A listener error is logged but never propagates to the HTTP response.

---

## Event bus implementation

```typescript
// apps/api/src/events/event-bus.ts
class EventBus {
  private emitter = new EventEmitter();

  emit<T extends DomainEventName>(name: T, payload: DomainEventPayload<T>): void {
    this.emitter.emit(name, payload);
  }

  on<T extends DomainEventName>(name: T, listener: (payload: DomainEventPayload<T>) => void): void {
    this.emitter.on(name, listener);
  }
}
```

Listeners are registered at app startup in `apps/api/src/events/listeners/`:
- `audit.listener.ts` — writes to `audit_logs` collection
- `notification.listener.ts` — sends push/email via Firebase + Resend
- `effective-plan.listener.ts` — refreshes `effectiveLimits` on org doc
- `event-denorm.listener.ts` — updates denormalized event stats

---

## Audit listener

The audit listener writes one `AuditLogEntry` to Firestore for every domain event it handles.

```typescript
// apps/api/src/events/listeners/audit.listener.ts
eventBus.on('registration.created', async ({ registration, actor, requestId }) => {
  await auditLogsRepo.create({
    action: 'registration.created',
    actorId: actor.uid,
    requestId,
    timestamp: new Date().toISOString(),
    resourceType: 'registration',
    resourceId: registration.id,
    eventId: registration.eventId,
    organizationId: registration.organizationId,
    details: {
      ticketType: registration.ticketTypeName,
      participantEmail: registration.participantEmail,
    },
  });
});
```

**Audit writes are fire-and-forget and never written inside transactions.** If the business operation (registration creation) succeeds but the audit write fails, the audit failure is logged to Sentry but the registration is not rolled back.

This is intentional. Rolling back a registration because the audit write failed would be worse than a missing audit log entry. Audit completeness is monitored separately.

---

## Domain events catalog (selected)

| Event name | Emitted by | Listener actions |
|---|---|---|
| `registration.created` | RegistrationService | Audit, send confirmation email, generate badge |
| `registration.cancelled` | RegistrationService | Audit, promote from waitlist |
| `registration.approved` | RegistrationService | Audit, generate badge |
| `checkin.completed` | CheckinService | Audit, increment checkedInCount |
| `checkin.bulk_synced` | CheckinService | Audit (single record for batch) |
| `event.created` | EventService | Audit |
| `event.published` | EventService | Audit, index for discovery |
| `event.scan_policy_changed` | EventService | Audit |
| `event.qr_key_rotated` | EventService | Audit |
| `subscription.upgraded` | SubscriptionService | Audit, refresh effectiveLimits |
| `subscription.downgraded` | SubscriptionService | Audit, queue scheduledChange |
| `subscription.change_scheduled` | SubscriptionService | Audit |
| `subscription.period_rolled_over` | Cloud Scheduler | Audit, apply scheduledChange if any |
| `payment.initiated` | PaymentService | Audit |
| `payment.succeeded` | PaymentService | Audit, confirm registration, generate badge |
| `payment.failed` | PaymentService | Audit, cancel registration |
| `member.added` | OrganizationService | Audit |
| `invite.created` | OrganizationService | Audit, send invitation email |
| `plan.created` | PlanService | Audit |
| `badge.generated` | BadgeService | Audit |
| `checkin.offline_sync.downloaded` | CheckinService | Audit |

Full list of all 83 `AuditAction` values: [audit-actions reference](../reference/audit-actions.md).

---

## Request context propagation

The `requestId` carried in every audit log comes from the `AsyncLocalStorage` request context, not from a function parameter. This means services don't need to accept a `requestId` argument — they call `getRequestId()` from anywhere in the call chain.

```typescript
// apps/api/src/context/request-context.ts
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext {
  return asyncLocalStorage.getStore() ?? { requestId: 'unknown', userId: null };
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(ctx, fn);
}
```

The middleware wraps each request:

```typescript
// authenticate middleware (after token verification)
enrichContext({ userId: decodedToken.uid, organizationId: decodedToken.organizationId });
```

---

## Error isolation

Listener errors must never crash the event bus or propagate to the API response. The event bus wraps each listener invocation:

```typescript
this.emitter.on(name, async (payload) => {
  try {
    await listener(payload);
  } catch (error) {
    logger.error({ error, event: name }, 'Listener error');
    captureError(error, { event: name, payload });
    // never re-throw
  }
});
```

---

## Testing domain events

In tests, inject a mock event bus and assert that the expected events are emitted:

```typescript
const mockEventBus = { emit: vi.fn() };
const service = new RegistrationService(mockRepo, mockEventBus);

await service.register(user, dto);

expect(mockEventBus.emit).toHaveBeenCalledWith('registration.created', 
  expect.objectContaining({ registration: expect.objectContaining({ id: expect.any(String) }) })
);
```
