# ADR-0007: Fastify layered architecture (routes / services / repositories)

**Status:** Accepted  
**Date:** 2026-01

---

## Context

The API codebase needed a structural pattern that:
1. Scales to 39+ routes without becoming a monolith
2. Makes business logic unit-testable without HTTP overhead
3. Enforces a clear separation between HTTP concerns, business logic, and data access
4. Supports consistent middleware injection (auth, validation, permission)

---

## Decision

**Adopt a strict three-layer architecture with enforced layer discipline.**

```
Route handlers (HTTP layer)
    → Middleware chain (auth, validate, requirePermission)
    → Service methods (business logic)
        → Repository methods (Firestore CRUD)
            → Firestore
```

**Layer contracts:**

- **Routes** — HTTP only. Parse request, call service, return response. Zero business logic. Zero Firestore calls.
- **Services** — All business logic. Call repositories. Emit domain events. Never call Fastify/HTTP objects.
- **Repositories** — Firestore CRUD only. No business logic. Generic `BaseRepository<T>` for common operations.

**Forbidden patterns:**
- Business logic in route handlers
- Firestore calls outside repositories
- Service methods accepting `FastifyRequest` objects
- `console.log` in services (use logger from request context)

---

## Middleware chain pattern

```typescript
// In route file
fastify.post('/events', {
  preHandler: [
    authenticate,                          // sets request.user
    validate({ body: CreateEventSchema }), // Zod validation
    requirePermission('event:create'),     // RBAC
  ],
  handler: async (request, reply) => {
    const result = await eventService.create(request.user, request.body);
    return reply.code(201).send({ success: true, data: result });
  },
});
```

---

## BaseRepository pattern

```typescript
class BaseRepository<T extends { id: string }> {
  constructor(
    protected db: Firestore,
    protected collectionName: string
  ) {}

  async findById(id: string): Promise<T | null> { ... }
  async findAll(query?: QueryOptions): Promise<T[]> { ... }
  async create(data: Omit<T, 'id'> & { id?: string }): Promise<T> { ... }
  async update(id: string, data: Partial<T>): Promise<T> { ... }
  // No delete — soft-delete only via update({ status: 'archived' })
}
```

Concrete repositories extend `BaseRepository<T>` and add domain-specific queries:

```typescript
class EventRepository extends BaseRepository<Event> {
  async findByOrg(orgId: string, options: QueryOptions): Promise<Event[]> { ... }
  async countActiveByOrg(orgId: string): Promise<number> { ... }
}
```

---

## Error handling

All errors are typed subclasses of `AppError`:

```typescript
class AppError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}

class NotFoundError extends AppError { constructor(resource: string) { super(404, 'NOT_FOUND', `${resource} not found`); } }
class ForbiddenError extends AppError { constructor(msg?: string) { super(403, 'FORBIDDEN', msg ?? 'Access denied'); } }
class PlanLimitError extends AppError { constructor(resource: string, current: number, limit: number) { super(402, 'PLAN_LIMIT_EXCEEDED', ...); } }
```

Fastify's global error handler catches all `AppError` subclasses and serializes them to `{ success: false, error: { code, message, details } }`. Unhandled errors become 500s.

---

## Consequences

- Route files are thin — typically 20–40 lines each.
- Services are fully testable with mocked repositories and a mocked event bus — no Fastify setup needed.
- Adding a new endpoint requires: 1 route file, 1 service method, possibly 1 repository method.
- The `@/` path alias in tsconfig maps to `apps/api/src/` — use `@/services/event.service` not relative paths.
