---
title: Testing Guide
status: shipped
last_updated: 2026-04-25
---

# Testing Guide

---

## Test runners

| Package | Runner | Config |
|---|---|---|
| `apps/api` | Vitest | `vitest.config.ts` |
| `packages/shared-types` | Vitest | `vitest.config.ts` |
| `apps/web-backoffice` | Vitest + Testing Library | `vitest.config.ts` |
| `apps/web-participant` | Vitest + Testing Library | `vitest.config.ts` |
| `apps/mobile` | Flutter test | `test/` directory |

---

## Running tests

```bash
# All API tests (run from repo root or apps/api)
cd apps/api && npx vitest run

# Watch mode
cd apps/api && npx vitest

# Specific test file
cd apps/api && npx vitest src/services/__tests__/event.service.test.ts

# Flutter
cd apps/mobile && flutter test
```

**Run the full API test suite before every commit:**
```bash
cd apps/api && npx vitest run
```

---

## Test factories

All tests share factories from `apps/api/src/__tests__/factories.ts`:

```typescript
import { buildAuthUser, buildOrganizerUser, buildSuperAdmin, buildEvent, buildRegistration } from '../__tests__/factories';

const organizer = buildOrganizerUser({ organizationId: 'org_1' });
const event = buildEvent({ organizationId: 'org_1', status: 'published' });
const registration = buildRegistration({ eventId: event.id, userId: organizer.uid });
```

Always use factories for test data — never hardcode fixture objects in test files.

---

## Service unit tests

Service tests mock repositories and the event bus. They never touch Firestore.

```typescript
// apps/api/src/services/__tests__/event.service.test.ts
describe('EventService.create()', () => {
  let service: EventService;
  let mockEventRepo: ReturnType<typeof mockRepository>;
  let mockEventBus: { emit: ReturnType<typeof vi.fn> };
  
  beforeEach(() => {
    mockEventRepo = mockRepository();
    mockEventBus = { emit: vi.fn() };
    service = new EventService(mockEventRepo, mockEventBus, mockOrgRepo);
  });

  it('creates event and emits domain event', async () => {
    const organizer = buildOrganizerUser();
    mockEventRepo.create.mockResolvedValue(buildEvent());
    
    const result = await service.create(organizer, { organizationId: organizer.organizationId, ... });
    
    expect(mockEventRepo.create).toHaveBeenCalled();
    expect(mockEventBus.emit).toHaveBeenCalledWith('event.created', expect.objectContaining({ event: result }));
  });

  it('throws PlanLimitError when maxEvents exceeded', async () => {
    const organizer = buildOrganizerUser();
    mockOrgRepo.findById.mockResolvedValue(buildOrg({ plan: 'free' }));
    mockEventRepo.countActiveByOrg.mockResolvedValue(3); // at limit
    
    await expect(service.create(organizer, dto)).rejects.toThrow(PlanLimitError);
  });

  it('throws ForbiddenError when user is from different org', async () => {
    const organizer = buildOrganizerUser({ organizationId: 'org_A' });
    const dto = { organizationId: 'org_B', ... }; // different org
    
    await expect(service.create(organizer, dto)).rejects.toThrow(ForbiddenError);
  });
});
```

### Required test cases for every service method

1. **Happy path** — succeeds with valid input and correct permissions
2. **Permission denial** — throws `ForbiddenError` when user lacks the required permission
3. **Org isolation** — throws `ForbiddenError` when user accesses a different org's data
4. **Plan limit** — throws `PlanLimitError` when the relevant limit is exceeded (for gated methods)
5. **Not found** — throws `NotFoundError` when a referenced entity does not exist

---

## Transactional tests

When a service uses `db.runTransaction()`, the test must provide a mock transaction:

```typescript
import { mockDb, mockTransaction } from '../__tests__/firebase-mocks';

it('increments counter atomically', async () => {
  const mockTx = mockTransaction();
  mockTx.get.mockResolvedValue({ data: () => ({ count: 5 }) });
  mockDb.runTransaction.mockImplementation((fn) => fn(mockTx));
  
  await service.register(user, dto);
  
  expect(mockTx.update).toHaveBeenCalledWith(counterRef, { count: 6 });
});
```

---

## Route integration tests

Route tests use `fastify.inject()` — no real HTTP connections.

```typescript
// apps/api/src/routes/__tests__/events.routes.test.ts
describe('POST /v1/events', () => {
  it('returns 201 for valid organizer request', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { Authorization: `Bearer ${organizerToken}` },
      payload: validEventDto,
    });
    
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).success).toBe(true);
  });

  it('returns 401 without auth token', async () => {
    const response = await fastify.inject({ method: 'POST', url: '/v1/events', payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 for participant (wrong role)', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { Authorization: `Bearer ${participantToken}` },
      payload: validEventDto,
    });
    expect(response.statusCode).toBe(403);
  });
});
```

---

## Mocking Firebase

```typescript
// Mock the firebase-admin module
vi.mock('@/config/firebase', () => ({
  db: mockFirestore(),
  auth: mockAuth(),
  COLLECTIONS: {
    EVENTS: 'events',
    REGISTRATIONS: 'registrations',
    // ...
  },
}));
```

---

## QR signing tests

Import directly from the signing module — no duplication needed:

```typescript
import { signQrV4, verifyQr } from '@/services/qr-signing';

it('rejects tampered QR', async () => {
  const qrValue = await signQrV4(params, 'test-kid', 'test-master-secret');
  const tampered = qrValue.replace(qrValue.slice(-8), 'ffffffff');
  
  await expect(verifyQr(tampered, event, 'test-master-secret')).rejects.toThrow('QR_INVALID_SIGNATURE');
});
```

---

## Snapshot tests

`packages/shared-types/src/__tests__/snapshot.test.ts` prevents unintended schema changes:

```bash
# Update snapshots after an intentional schema change
cd packages/shared-types && npx vitest run --reporter=verbose -u
```

Always review snapshot diffs carefully — an unexpected snapshot change indicates a breaking schema change.
