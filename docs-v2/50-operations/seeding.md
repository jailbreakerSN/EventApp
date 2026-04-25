---
title: Seeding
status: shipped
last_updated: 2026-04-25
---

# Seeding

> **Status: shipped** — Seed script is idempotent and runs on every staging deploy.

---

## Running the seed

```bash
# Local (emulators must be running)
npx tsx scripts/seed-emulators.ts

# Staging
npm run seed:staging
```

The script is **idempotent** — re-running it is safe. It upserts entities by deterministic ID rather than creating duplicates. The only exception: in staging, the bulk entity seed is skipped if organizations already exist (to preserve live test data).

---

## What gets seeded

### Users

Source of truth: `scripts/seed/02-users.ts` (`PASSWORD = "password123"` constant — applies to **every** seed account).

| Email | Persona | Plan / Org |
|---|---|---|
| `admin@teranga.dev` | Super admin (cross-org) | n/a |
| `organizer@teranga.dev` | Organizer + owner | **Pro** — Teranga Events SRL |
| `coorganizer@teranga.dev` | Co-organizer | Teranga Events SRL |
| `starter@teranga.dev` | Organizer + owner | **Starter** — Dakar Digital Hub |
| `free@teranga.dev` | Organizer + owner | **Free** — Startup Dakar |
| `enterprise@teranga.dev` | Organizer + owner | **Enterprise** — Groupe Sonatel Events |
| `venue@teranga.dev` | Venue manager | Dakar Venues & Hospitality |
| `participant@teranga.dev` | Participant | — |
| `participant2@teranga.dev` | Participant (second canonical) | — |
| `speaker@teranga.dev` | Speaker (event-scoped) | — |
| `sponsor@teranga.dev` | Sponsor (event-scoped) | — |
| `staff@teranga.dev` | Staff (event-scoped scanner) | — |
| `multirole@teranga.dev` | Organizer + speaker (multi-role test) | — |
| `authonly@teranga.dev` | Auth-only (no roles assigned, edge case) | — |

Plus ~27 expansion participants with deterministic emails like `<firstname>.<n>@teranga.dev` (see `EXPANSION_PARTICIPANT_UIDS` + `expansionParticipantEmail()`).

### Organizations

| Name | Plan | Owner |
|---|---|---|
| Teranga Events SRL | pro | `organizer@teranga.dev` |
| Dakar Digital Hub | starter | `starter@teranga.dev` |
| Startup Dakar | free | `free@teranga.dev` |
| Groupe Sonatel Events | enterprise | `enterprise@teranga.dev` |
| Dakar Venues & Hospitality | starter | `venue@teranga.dev` |

### Events

The seed writes **22 hand-crafted canonical events** (`scripts/seed/04-events.ts`) covering every category, format, plan tier, and lifecycle state — past / live / upcoming, draft / published / cancelled / archived, free / paid, in-person / online / hybrid. On top of that, **80 procedurally generated synthetic events** (`scripts/seed/09-rich-dataset.ts`) fan out across the same orgs while honouring `PLAN_LIMITS.maxEvents` (free org gets 0 synthetic — the 3 canonical free events already saturate the cap).

Total: ~102 events, ~1 900 registrations (synthetic regs round-robin the 27 expansion participants so every join → user surface renders real data, not blanks).

### Other entities

- 3 venues (1 approved, 1 pending, 1 suspended) — Dakar locations
- 6 canonical registrations + ~1 900 synthetic
- 2 badges (generated)
- 4 sessions with speakers
- 3 feed posts
- 2 conversations
- 5 notifications
- 2 payments (1 succeeded, 1 pending)
- 1 receipt
- 7 subscriptions (sub-001 … sub-007 — see `06-social.ts`)
- 2 speakers, 2 sponsors
- 1 broadcast
- 5 plan coupons + 4 coupon redemptions (see `08-admin-fixtures.ts`)
- Audit logs for key actions

### QA fixtures (always upserted)

`scripts/seed-qa-fixtures.ts` upserts three additional accounts on every deploy for CI/role-coverage tests. Same `password123`. The QA emails do NOT carry a `qa-` prefix:

- `staff@teranga.dev` — staff role (event-scoped scanner) — also part of the canonical seed
- `multirole@teranga.dev` — organizer + speaker (multi-role test)
- `authonly@teranga.dev` — no roles (auth edge case)

---

## Plan catalog

The 4 system plans (free, starter, pro, enterprise) are always upserted by the seed script. This ensures the `plans` collection exists even on a fresh environment.

---

## Customizing seed data

The seed script is in `scripts/seed-emulators.ts`. All entities use deterministic IDs (derived from a fixed seed value) so re-runs are idempotent.

To add a new entity to the seed:
1. Add a constant object with a deterministic `id`
2. Call `db.collection('collection').doc(id).set(data, { merge: true })`
3. Test: run the seed twice and verify the entity count doesn't double

---

## Staging seed safety guard

The staging seed includes a guard:

```typescript
const orgsSnapshot = await db.collection('organizations').limit(1).get();
if (!orgsSnapshot.empty) {
  console.log('Staging has existing data — skipping bulk seed. Running plan backfill only.');
  await backfillEffectiveLimits();
  return;
}
```

This prevents overwriting live staging data on every CI deploy. The balance-ledger backfill and QA fixture upsert always run regardless.
