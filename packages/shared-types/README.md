# `@teranga/shared-types`

The platform's **single source of truth** for data shapes. All Zod schemas, TypeScript types, plan definitions, permissions, and audit-action enums live here. Every other workspace imports from this package.

> **Canonical reference:** [`docs-v2/40-clients/shared/shared-types.md`](../../docs-v2/40-clients/shared/shared-types.md), plus [ADR-0002](../../docs-v2/20-architecture/decisions/0002-zod-single-source-of-truth.md).

## What lives here

```
src/
├── auth.types.ts             # AuthUser, sessions
├── audit.types.ts            # AuditAction enum + AuditLogSchema
├── badge.types.ts            # Badge, BadgeTemplate
├── checkin.types.ts          # Checkin event + sync payload
├── common.types.ts           # IsoDateTimeSchema, paginated wrappers
├── event.types.ts            # Event, Ticket, Session, Speaker, Sponsor
├── feed.types.ts             # FeedPost, comment, reaction
├── messaging.types.ts        # Thread, Message
├── notification.types.ts     # NotificationKind, dispatch log
├── notification-catalog.ts   # The notification catalog (canonical event list)
├── organization.types.ts     # Organization, plan limits, subscription
├── permissions.types.ts      # Permission union, role bundles, scopes
├── registration.types.ts     # Registration + status state machine
├── subscription.types.ts     # Subscription + PlanUsageSchema
├── user.types.ts             # User profile, FCM tokens
├── ...
```

## How to consume

```typescript
import { EventSchema, type Event } from "@teranga/shared-types";

// API: validate request
const parsed = EventSchema.parse(request.body);

// Web: type-safe form values
const form = useForm<Event>({ resolver: zodResolver(EventSchema) });
```

## Build process

This package compiles to `dist/` via `tsc`. **Other packages depend on the compiled output**, not the source — so you must rebuild after schema changes:

```bash
npm run types:build        # from repo root, recommended
# or
npm run build --workspace=@teranga/shared-types
```

CI builds this first (the `shared-types` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) and uploads `dist/` as an artifact for downstream jobs.

## Test discipline

This package houses three load-bearing test categories:

- **Contract snapshots** — every schema's `.parse()` shape is pinned. A field rename or type change shows up as a snapshot diff.
- **i18n key coverage** — `fr` / `en` / `wo` translation files are checked for missing or extra keys per app.
- **Permissions matrix** — the `resolvePermissions()` output for every role × scope is pinned.

Update with care: `npx vitest run -u` regenerates snapshots, but **always read the diff line-by-line** before committing — see CLAUDE.md → "Snapshot tests — pin discipline".

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | Compile to `dist/` |
| `npm run dev` | Watch-mode compile |
| `npm run test` | Vitest (contract snapshots + i18n + permissions) |
| `npm run lint` | ESLint over `src/` |
| `npm run type-check` | `tsc --noEmit` |

## Conventions

- **Zod over plain TS types.** Always export both: `EventSchema = z.object({...})` and `type Event = z.infer<typeof EventSchema>`.
- **Discriminated unions** for state machines. Every `status` field uses `z.enum([...])`.
- **ISO 8601 strings** for timestamps via `IsoDateTimeSchema` (see [ADR-0009](../../docs-v2/20-architecture/decisions/0009-iso-8601-timestamps.md)).
- **`$Infer`** for generic helpers.
- Mobile (Flutter) does **not** import this package directly — instead, the data shapes are mirrored manually in Dart. Drift is caught by integration tests when payloads round-trip.
