# ADR-0002: Zod schemas as single source of truth for data shapes

**Status:** Accepted  
**Date:** 2026-01  
**Deciders:** Platform team

---

## Context

The Teranga monorepo has three TypeScript consumers of shared data shapes (API, web backoffice, web participant) plus a Flutter mobile app. We need a way to define data shapes once and share them without drift.

Options:
1. **Manually duplicate types** in each package — simple but drifts immediately
2. **JSON Schema + code generation** — verbose, extra build step
3. **GraphQL schema + code gen** — powerful but overkill for a REST API; adds a resolver layer
4. **Zod schemas in a shared package** — types inferred at compile time from the same runtime validators

---

## Decision

**Define all domain data shapes as Zod schemas in `packages/shared-types/`. TypeScript types are inferred from schemas (`z.infer<typeof Schema>`). The API validates all request bodies against these schemas.**

---

## Structure

```
packages/shared-types/src/
├── event.types.ts          # EventSchema, CreateEventSchema, UpdateEventSchema
├── registration.types.ts   # RegistrationSchema, RegisterSchema
├── organization.types.ts   # OrgSchema, PLAN_LIMITS, PlanFeatures
├── permissions.types.ts    # SystemRole, permissions map, resolvePermissions()
├── subscription.types.ts   # SubscriptionSchema, PlanUsageSchema
├── ... (one file per domain entity)
└── index.ts                # re-exports everything
```

After any change to this package, run:
```bash
npm run types:build
```

---

## Benefits

1. **Zero schema drift** — the runtime validator and the TypeScript type are always in sync. If validation passes, the type is correct.
2. **One place to update** — add a field in one file, rebuild, done.
3. **Self-documenting** — Zod schemas read like documentation. `.describe()` annotations can generate OpenAPI automatically.
4. **Flutter mirror** — the Flutter app manually mirrors the schemas as Dart `freezed` models. The schemas are the authoritative reference for what to mirror.

---

## Constraints

1. **Must rebuild after every change** — `npm run types:build` is easy to forget. The CI gate enforces this (shared-types build runs first, blocking downstream jobs).
2. **Flutter does not use Zod** — Dart uses json_serializable + Freezed. Engineers must manually keep Flutter models in sync with the Zod schemas. The shared-types package has a snapshot test that catches breaking schema changes, but Flutter drift requires human review.
3. **No auto-generated OpenAPI from Zod** — Swagger docs are written manually in route files. This is a known gap.

---

## Consequences

- `@teranga/shared-types` is a hard dependency of every TypeScript app and package.
- Breaking changes to a schema (removing a required field) require updates in all consumers before merging.
- The `snapshot.test.ts` in shared-types will catch unintended schema shape changes.
