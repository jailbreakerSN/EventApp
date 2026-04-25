---
title: Coding Standards
status: shipped
last_updated: 2026-04-25
---

# Coding Standards

---

## TypeScript (API, Functions, Web, Shared Types)

### General rules

- **Strict mode** everywhere — `"strict": true` in all tsconfigs
- **No `any`** — use `unknown` + narrowing. `any` triggers an ESLint warning
- **Type imports** — use `import type { Foo }` or `import { type Foo }` for type-only imports
- **Zod for validation** — all request bodies validated with schemas from `@teranga/shared-types`
- **Error responses** — always `{ success: false, error: { code, message, details } }`. Never throw raw strings

### Naming

| Entity | Convention | Example |
|---|---|---|
| Variables, functions | camelCase | `registrationCount`, `getOrgLimits` |
| Types, interfaces, classes | PascalCase | `EventService`, `RegistrationStatus` |
| Constants | SCREAMING_SNAKE | `PLAN_LIMITS`, `QR_MASTER_SECRET` |
| Files | kebab-case | `event.service.ts`, `qr-signing.ts` |
| Firestore collections | SCREAMING_SNAKE constant | `COLLECTIONS.EVENTS` |

### Forbidden patterns

```typescript
// ❌ console.log in service code
console.log('Registration created');

// ✅ Use Pino logger from request context
const { logger } = getRequestContext();
logger.info({ registrationId }, 'Registration created');

// ❌ Direct Firestore access in routes
fastify.post('/events', async (req) => {
  await db.collection('events').add(req.body); // ← forbidden
});

// ✅ Call service method
fastify.post('/events', async (req) => {
  const event = await eventService.create(req.user, req.body);
  return reply.send({ success: true, data: event });
});

// ❌ Business logic in repositories
class EventRepository {
  async create(data) {
    const limitCheck = await checkPlanLimit(...); // ← forbidden
  }
}

// ❌ Hard delete
await db.collection('registrations').doc(id).delete();

// ✅ Soft delete
await registrationRepo.update(id, { status: 'cancelled', cancelledAt: now() });
```

### API patterns

```typescript
// Route handler — thin controller
fastify.post('/events', {
  preHandler: [
    authenticate,
    validate({ body: CreateEventSchema }),
    requirePermission('event:create'),
  ],
  handler: async (request, reply) => {
    const event = await eventService.create(request.user, request.body);
    return reply.code(201).send({ success: true, data: event });
  },
});

// Service method — org isolation + plan check + domain event
async create(user: AuthUser, dto: CreateEventDto): Promise<Event> {
  await this.requireOrganizationAccess(user, dto.organizationId);
  await this.requirePermission(user, 'event:create');
  const limitCheck = await this.checkPlanLimit(org, 'maxEvents', activeCount);
  if (!limitCheck.allowed) throw new PlanLimitError(...);
  const event = await this.eventRepo.create(dto);
  this.eventBus.emit('event.created', { event, actor: user });
  return event;
}
```

### Transactions

Any operation that reads data and then writes based on that read **must** use `db.runTransaction()`:

```typescript
// ❌ Race condition — count can change between reads and write
const count = await this.eventRepo.countActiveByOrg(orgId);
if (count >= limit) throw new PlanLimitError(...);
await this.eventRepo.create(dto); // another request may have created concurrently

// ✅ Atomic — count + create in transaction
await db.runTransaction(async (tx) => {
  const count = await tx.get(countRef);
  if (count.data().value >= limit) throw new PlanLimitError(...);
  tx.set(newEventRef, dto);
});
```

---

## Flutter / Dart

### Structure

Feature-first folder layout:
```
lib/features/{feature}/
├── presentation/
│   ├── pages/          # Screens
│   └── widgets/        # Feature-specific widgets
├── providers/          # Riverpod providers
└── data/              # API calls, local storage
```

### Rules

- **Riverpod 2** for all state — `@riverpod` annotations, `ConsumerWidget` / `ConsumerStatefulWidget`
- **go_router** for navigation — typed routes with `context.go('/path')`
- **Hive** for offline-critical data — QR cache, check-in queue
- **No `setState`** for app-level state — only for purely local widget state
- After changing providers/Freezed models: `flutter pub run build_runner build --delete-conflicting-outputs`

---

## CSS / Tailwind

- Use Tailwind utility classes — no inline styles unless absolutely necessary
- Use design tokens from `packages/shared-config` (teranga-navy, teranga-gold, etc.) — never hardcode hex colors
- Use CSS variables for theme-aware colors — `var(--primary)`, `var(--background)`, etc.
- `cn()` from `@teranga/shared-ui` for conditional class composition

---

## Comments

Write comments only when the **why** is non-obvious. Never write:
- Comments explaining what the code does (the code does that)
- Comments referencing the task/ticket ("added for issue #123") — put that in the PR description
- Multi-line block comments or docstrings for simple functions

Good comment:
```typescript
// crypto.timingSafeEqual prevents timing attacks during HMAC comparison
if (!timingSafeEqual(expected, actual)) throw new QrInvalidSignatureError();
```

Bad comment:
```typescript
// Check if the user has permission to create an event
await this.requirePermission(user, 'event:create');
```
