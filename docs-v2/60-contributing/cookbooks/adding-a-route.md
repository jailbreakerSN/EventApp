# Cookbook: Adding a New API Route

A step-by-step guide for adding a new endpoint to the Fastify API.

---

## 1. Define the Zod schema in shared-types

If the endpoint introduces a new request or response shape, define it first:

```typescript
// packages/shared-types/src/my-entity.types.ts
import { z } from 'zod';

export const CreateMyEntitySchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
});

export type CreateMyEntityDto = z.infer<typeof CreateMyEntitySchema>;
export type MyEntity = z.infer<typeof MyEntitySchema>;
```

Then rebuild:
```bash
npm run types:build
```

---

## 2. Add the Firestore collection constant

```typescript
// apps/api/src/config/firebase.ts
export const COLLECTIONS = {
  // ... existing
  MY_ENTITIES: 'my_entities',   // ← add here
};
```

---

## 3. Create the repository

```typescript
// apps/api/src/repositories/my-entity.repository.ts
import { BaseRepository } from './base.repository';
import type { MyEntity } from '@teranga/shared-types';

export class MyEntityRepository extends BaseRepository<MyEntity> {
  constructor(db: Firestore) {
    super(db, COLLECTIONS.MY_ENTITIES);
  }

  async findByOrg(orgId: string): Promise<MyEntity[]> {
    return this.findAll({ where: [['organizationId', '==', orgId]] });
  }
}
```

---

## 4. Create the service

```typescript
// apps/api/src/services/my-entity.service.ts
import { BaseService } from './base.service';
import type { AuthUser, CreateMyEntityDto } from '@teranga/shared-types';

export class MyEntityService extends BaseService {
  constructor(
    private readonly myEntityRepo: MyEntityRepository,
    private readonly orgRepo: OrganizationRepository,
    eventBus: EventBus,
  ) {
    super(eventBus);
  }

  async create(user: AuthUser, dto: CreateMyEntityDto): Promise<MyEntity> {
    // 1. Org isolation — always first
    await this.requireOrganizationAccess(user, dto.organizationId);
    
    // 2. Permission check
    await this.requirePermission(user, 'my_entity:create');
    
    // 3. Plan limit check (if applicable)
    const org = await this.orgRepo.findById(dto.organizationId);
    // await this.requirePlanFeature(org, 'someFeature');
    
    // 4. Business logic
    const entity = await this.myEntityRepo.create({
      ...dto,
      createdBy: user.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    
    // 5. Emit domain event — always after successful write
    this.eventBus.emit('my_entity.created', { entity, actor: user });
    
    return entity;
  }
}
```

---

## 5. Create the route file

```typescript
// apps/api/src/routes/my-entities.routes.ts
import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '@/middlewares/auth.middleware';
import { requirePermission } from '@/middlewares/permission.middleware';
import { validate } from '@/middlewares/validate.middleware';
import { CreateMyEntitySchema } from '@teranga/shared-types';

const myEntitiesRoutes: FastifyPluginAsync = async (fastify) => {
  const service = fastify.diContainer.resolve('myEntityService');

  fastify.post('/', {
    preHandler: [
      authenticate,
      validate({ body: CreateMyEntitySchema }),
      requirePermission('my_entity:create'),
    ],
    handler: async (request, reply) => {
      const entity = await service.create(request.user, request.body);
      return reply.code(201).send({ success: true, data: entity });
    },
  });

  fastify.get('/', {
    preHandler: [authenticate, requirePermission('my_entity:read')],
    handler: async (request, reply) => {
      const { orgId } = request.query as { orgId: string };
      const entities = await service.list(request.user, orgId);
      return reply.send({ success: true, data: entities });
    },
  });
};

export default myEntitiesRoutes;
```

---

## 6. Register the route in the app

```typescript
// apps/api/src/app.ts
import myEntitiesRoutes from './routes/my-entities.routes';

fastify.register(myEntitiesRoutes, { prefix: '/v1/my-entities' });
```

---

## 7. Add Firestore security rules

```javascript
// infrastructure/firebase/firestore.rules
match /my_entities/{entityId} {
  allow read: if belongsToOrg(resource.data.organizationId) || isSuperAdmin();
  allow create: if belongsToOrg(request.resource.data.organizationId)
    && hasRole('organizer')
    && immutableOnUpdate(['organizationId', 'createdBy']);
  allow update: if belongsToOrg(resource.data.organizationId)
    && immutableOnUpdate(['organizationId', 'createdBy']);
  allow delete: if false; // soft-delete only
}
```

---

## 8. Write tests

```typescript
// apps/api/src/services/__tests__/my-entity.service.test.ts
describe('MyEntityService.create()', () => {
  it('creates entity for valid organizer');
  it('throws ForbiddenError for wrong org');
  it('throws ForbiddenError for participant role');
  // if plan-gated:
  it('throws PlanLimitError for free plan');
  it('emits my_entity.created domain event');
});
```

---

## 9. Add audit action

```typescript
// packages/shared-types/src/audit.types.ts
export const AuditAction = z.enum([
  // ... existing
  'my_entity.created',   // ← add here
  'my_entity.updated',
  'my_entity.deleted',
]);
```

Rebuild after adding: `npm run types:build`

---

## Checklist before submitting PR

- [ ] Schema added to shared-types and rebuilt
- [ ] `COLLECTIONS` constant updated
- [ ] Repository created/updated
- [ ] Service has `requireOrganizationAccess()` as first call
- [ ] Service emits domain event after every mutation
- [ ] Route has `authenticate + validate + requirePermission` in `preHandler`
- [ ] Firestore rules updated for new collection
- [ ] Unit tests: happy path + ForbiddenError + org isolation
- [ ] API docs updated in `docs-v2/30-api/`
