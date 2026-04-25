---
title: Cookbook: Adding a Domain Event
status: shipped
last_updated: 2026-04-25
---

# Cookbook: Adding a Domain Event

---

## When to add a domain event

Every **mutation** in a service method must emit a domain event. This includes:
- Creating any entity
- Updating any entity (especially status changes)
- Deleting (soft-deleting) an entity
- Any significant business state transition

Domain events power the audit trail, push notifications, and plan denormalization. Missing events break the audit trail silently.

---

## Step 1: Add the action to the AuditAction enum

```typescript
// packages/shared-types/src/audit.types.ts
export const AuditAction = z.enum([
  // ... existing actions
  'venue.suspended',   // ← new action
]);
```

Rebuild: `npm run types:build`

---

## Step 2: Define the event payload type

```typescript
// apps/api/src/events/event-bus.types.ts
export interface DomainEvents {
  // ... existing
  'venue.suspended': {
    venue: Venue;
    actor: AuthUser;
    reason?: string;
  };
}
```

---

## Step 3: Emit the event in the service

```typescript
// apps/api/src/services/venue.service.ts
async suspend(user: AuthUser, venueId: string, reason?: string): Promise<Venue> {
  await this.requirePermission(user, 'venue:suspend');
  
  const venue = await this.venueRepo.findById(venueId);
  if (!venue) throw new NotFoundError('Venue');
  
  const updated = await this.venueRepo.update(venueId, {
    status: 'suspended',
    suspendedAt: new Date().toISOString(),
    suspendedBy: user.uid,
  });
  
  // Always after the write succeeds
  this.eventBus.emit('venue.suspended', { venue: updated, actor: user, reason });
  
  return updated;
}
```

---

## Step 4: Add the audit listener entry

```typescript
// apps/api/src/events/listeners/audit.listener.ts
eventBus.on('venue.suspended', async ({ venue, actor, reason }) => {
  const { requestId } = getRequestContext();
  await auditLogsRepo.create({
    action: 'venue.suspended',
    actorId: actor.uid,
    requestId,
    timestamp: new Date().toISOString(),
    resourceType: 'venue',
    resourceId: venue.id,
    organizationId: venue.hostOrganizationId,
    details: { reason: reason ?? null },
  });
});
```

---

## Step 5: Add notification listener entry (if applicable)

If the event should trigger a push notification or email:

```typescript
// apps/api/src/events/listeners/notification.listener.ts
eventBus.on('venue.suspended', async ({ venue, actor }) => {
  // Notify the venue owner
  await notificationService.sendToUser(venue.ownerUserId, {
    type: 'venue_suspended',
    title: 'Votre salle a été suspendue',
    body: `${venue.name} a été suspendue par l'administration.`,
  });
});
```

---

## Step 6: Test the event emission

```typescript
it('emits venue.suspended domain event', async () => {
  const mockEventBus = { emit: vi.fn(), on: vi.fn() };
  const service = new VenueService(mockVenueRepo, mockEventBus);
  
  await service.suspend(superAdmin, 'venue_1', 'Policy violation');
  
  expect(mockEventBus.emit).toHaveBeenCalledWith(
    'venue.suspended',
    expect.objectContaining({
      venue: expect.objectContaining({ id: 'venue_1', status: 'suspended' }),
      actor: superAdmin,
      reason: 'Policy violation',
    })
  );
});
```

---

## Rules

- **Fire after the write succeeds** — never emit before the Firestore write. If the write fails, the event should not fire.
- **Fire outside transactions** — audit writes must not be inside a `db.runTransaction()`. Emit after the transaction commits.
- **Never await domain events in the HTTP response path** — use the event bus's fire-and-forget pattern. If notification sending is slow, it should not slow down the HTTP response.
- **One event per logical action** — don't emit `entity.updated` and `entity.status_changed` for the same operation. Pick the most specific action.
