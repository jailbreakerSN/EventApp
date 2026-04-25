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

| Email | Password | Persona | Plan |
|---|---|---|---|
| `admin@teranga.dev` | `teranga2026!` | Organizer + owner | Pro |
| `organizer@teranga.dev` | `teranga2026!` | Organizer + owner | Starter |
| `free@teranga.dev` | `teranga2026!` | Organizer + owner | Free |
| `enterprise@teranga.dev` | `teranga2026!` | Organizer + owner | Enterprise |
| `participant@teranga.dev` | `teranga2026!` | Participant | — |
| `staff@teranga.dev` | `teranga2026!` | Staff (event-scoped) | — |
| `speaker@teranga.dev` | `teranga2026!` | Speaker (event-scoped) | — |
| `sponsor@teranga.dev` | `teranga2026!` | Sponsor (event-scoped) | — |
| `super@teranga.dev` | `teranga2026!` | Super admin | — |
| `qa-staff@teranga.dev` | `teranga2026!` | Multi-role test user | — |

### Organizations

| Name | Plan | Owner |
|---|---|---|
| Teranga Events SRL | pro | admin@teranga.dev |
| Dakar Digital Hub | starter | organizer@teranga.dev |
| Startup Dakar | free | free@teranga.dev |
| Groupe Sonatel Events | enterprise | enterprise@teranga.dev |

### Events

| Title | Status | Type | Org |
|---|---|---|---|
| DevConf Dakar 2026 | published | Paid (15 000 XOF) | Teranga Events SRL |
| Hackathon OpenData | published | Free | Teranga Events SRL |
| BarCamp Dakar | draft | Free | Dakar Digital Hub |
| Workshop Design Thinking | cancelled | Free | Dakar Digital Hub |

### Other entities

- 3 venues (1 approved, 1 pending, 1 suspended) — Dakar locations
- 6 registrations (mix of confirmed, waitlisted)
- 2 badges (generated)
- 4 sessions with speakers
- 3 feed posts
- 2 conversations
- 5 notifications
- 2 payments (1 succeeded, 1 pending)
- 1 receipt
- 3 subscriptions (for the 3 non-free orgs)
- 2 speakers, 2 sponsors
- 1 broadcast
- Audit logs for key actions

### QA fixtures (always upserted)

Three additional users seeded on every deploy for CI/role-coverage tests:
- `qa-staff@teranga.dev` — multi-role (staff + participant)
- `qa-multirole@teranga.dev` — organizer + participant
- `qa-authonly@teranga.dev` — no roles (auth edge case)

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
