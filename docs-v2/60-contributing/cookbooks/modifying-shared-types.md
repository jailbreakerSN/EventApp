# Cookbook: Modifying Shared Types

Changes to `packages/shared-types/` are high-impact — they affect the API, both web apps, and indirectly the Flutter app. Follow this process for every modification.

---

## Types of changes

| Change | Risk | Flutter impact |
|---|---|---|
| Add an optional field | Low | None (new field ignored until Flutter adds it) |
| Add a required field | High | Breaking — Flutter models must be updated |
| Remove a field | High | Breaking — any consumer using the field will break |
| Change a field type | High | Breaking |
| Add an enum value | Low | Flutter must add the new case or use a fallback |
| Remove an enum value | High | Breaking — existing data may have the removed value |
| Add a new schema/type | Low | None until Flutter needs to consume it |

---

## Step-by-step

### 1. Make the change

```typescript
// packages/shared-types/src/event.types.ts

// Example: adding an optional field
export const EventSchema = z.object({
  // ... existing fields
  externalRegistrationUrl: z.string().url().optional(), // ← new optional field
});
```

### 2. Export from index if new

```typescript
// packages/shared-types/src/index.ts
export { ExternalRegistrationSchema } from './external-registration.types'; // ← add if new file
```

### 3. Rebuild

```bash
npm run types:build
```

This compiles the TypeScript and updates the package's `dist/` directory. All importing packages now use the updated types.

### 4. Check snapshot tests

```bash
cd packages/shared-types && npx vitest run
```

If the snapshot test fails, the change was detected. Review the diff carefully. If the change is intentional:

```bash
cd packages/shared-types && npx vitest run -u  # update snapshots
```

**Never blindly accept a snapshot diff.** Read the diff and confirm the change is what you intended.

### 5. Update consuming code if needed

For required field additions, update:
- API seed data: `scripts/seed-emulators.ts`
- API service create/update calls
- Web form schemas (if UI collects the field)
- API tests (factory functions in `__tests__/factories.ts`)

### 6. Update Flutter (manual)

Dart models in `apps/mobile/lib/` mirror the Zod schemas. Update the relevant `.dart` file manually:

```dart
// apps/mobile/lib/features/events/data/event_model.dart
@freezed
class Event with _$Event {
  const factory Event({
    // ... existing
    String? externalRegistrationUrl, // ← add new field
  }) = _Event;
  
  factory Event.fromJson(Map<String, dynamic> json) => _$EventFromJson(json);
}
```

Then regenerate:
```bash
cd apps/mobile && flutter pub run build_runner build --delete-conflicting-outputs
```

### 7. Update Firestore security rules (if new field needs protection)

If the new field should be immutable after creation:
```javascript
allow update: if immutableOnUpdate(['externalRegistrationUrl']);
```

### 8. Update API documentation

Update the field in `docs-v2/20-architecture/reference/data-model.md` and the relevant API reference page.

---

## Breaking changes policy

**Breaking schema changes must not be merged without a migration plan.**

Before removing a field or changing a required field:
1. Check if existing Firestore documents use the field (query Firestore directly)
2. Plan data migration if needed
3. Ship as optional first (deprecate), then remove in a follow-up wave
4. Coordinate Flutter update timing

---

## The `@deprecated` pattern

When deprecating a field/type (e.g., during Phase 2–6 migration):

```typescript
/**
 * @deprecated Phase 6 — use effectiveLimits on org document instead.
 * Kept as compile-time safety net and seed source.
 */
export const PLAN_LIMITS = { ... };
```
