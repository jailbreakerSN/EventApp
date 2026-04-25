---
title: Demo walkthrough — first 5 minutes
status: shipped
last_updated: 2026-04-25
audience: sales, demos, onboarding
---

# Demo walkthrough — first 5 minutes

A scripted, 5-minute path through the seeded dataset. Hits every flagship feature without rehearsal, so a PM, a sales engineer, or a fresh contributor can show the platform without prep.

> **Prerequisites.** Local emulators running (`firebase emulators:start`), seed loaded (`npm run seed`), API + web-backoffice on ports 3000 + 3001, web-participant on 3002.

---

## Demo personas (password: `password123` for all seeded accounts)

| Email | Role | Plan | Purpose |
|-------|------|------|---------|
| `admin@teranga.dev` | super-admin | n/a | Cross-org admin views, audit logs, feature flags |
| `organizer@teranga.dev` | organizer | **Pro** (Teranga Events SRL) | Featured organizer, scaled events, paid tickets |
| `starter@teranga.dev` | organizer | **Starter** (Dakar Digital Hub) | Single venue org, growing usage |
| `free@teranga.dev` | organizer | **Free** (Startup Dakar) | Near plan limit — exercises gating UX |
| `enterprise@teranga.dev` | organizer | **Enterprise** (Sonatel) | White-label, advanced analytics |
| `staff@teranga.dev` | staff (scanner) | n/a | Check-in dashboard, manual + scan |
| `participant@teranga.dev` | participant | n/a | Discovery, registration, badge, feed |

(Email aliases + password are stable across reseeds. Source of truth: `scripts/seed/02-users.ts` — `PASSWORD = "password123"` constant.)

---

## Walkthrough (target: < 5 minutes)

### 0. Setup (≤ 30 s)
1. Tabs open: backoffice (3001), participant (3002), API docs (`http://localhost:3000/docs`).
2. Sign in to backoffice as `organizer@teranga.dev` (Pro plan organizer for Teranga Events SRL).

### 1. Pro organizer dashboard (60 s)
- **Events list**: ~25 events across past / live / upcoming, multi-city. Highlights: "Dakar Tech Summit 2026" (featured, 5 regs, paid VIP tier).
- **Plan widget (sidebar)**: shows "Pro" plan with usage meters. Plenty of headroom.
- **Calendar view**: dense grid with 100 events spread over 9 months — proves the dataset is rich enough to stress-test.

### 2. Free plan gating (45 s)
- Sign out, sign in as `free@teranga.dev`.
- Events list shows 3 events (free max). Sidebar reads "3/3 événements — plan Free".
- Click "Créer un événement" → blocked by `<PlanGate>` with upgrade CTA.
- Open Analytics page → blurred behind upgrade gate (`feature="advancedAnalytics"`).
- Communications → SMS toggle disabled (`feature="smsNotifications"`).

### 3. Participant flow (60 s)
- Open `localhost:3002` (participant app).
- Browse events near Dakar — discover "Atelier IA générative #001 (Dakar)".
- Sign in as `participant@teranga.dev` → hit "S'inscrire" — instant confirmation, badge shown.
- Switch language toggle to **Wolof** — synthetic event titles render `Atelier IA #001 (Dakar)` in WO; canonical events fall back to FR (gap noted in S2 of Sprint A audit).
- Open "Mon badge" — QR code visible, scannable.

### 4. Check-in flow (60 s)
- Sign in as `staff@teranga.dev` on backoffice.
- Pick an active event → "Mode check-in".
- Manual scan: paste QR from the participant tab → green flash + "Bienvenue".
- Try the same QR a second time → duplicate warning.
- Tab to "Audit" → see the entry just written (real-time).

### 5. Super-admin tour (60 s)
- Sign in as `admin@teranga.dev`.
- Admin → Events list — 100 events across all 4 orgs.
- Admin → Audit logs — last 50 entries; the check-in just done is at top.
- Admin → Announcements — 4 banners (info / warn / expired) visible to organizers.
- Admin → Feature flags — 6 flags with mixed enabled / rolloutPercent values.
- Admin → Plan coupons — 5 coupons, one expired, one disabled, all with redemption history.
- Admin → Jobs — 6 admin job runs (succeeded / running / failed) with audit-grade detail.

### 6. Wrap (30 s)
- Show OpenAPI: `localhost:3000/docs` → ~200 endpoints documented.
- Mention: dataset is **fully procedural** (Mulberry32 PRNG, fixed seed) so every reseed produces identical output.

---

## What this dataset proves

| Claim | Evidence in the seed |
|-------|---------------------|
| Multi-tenant freemium model works | 4 orgs × 4 plans, with one near the free-tier limit |
| Plan limits are enforced, not just shown | Free org's "create event" CTA is blocked; analytics + SMS gated |
| Audit trail is real and comprehensive | Every mutation creates an `auditLogs` entry |
| Offline check-in is the differentiator | Staff dashboard + duplicate detection + sync history |
| African-market positioning is genuine | Wolof/French names, multi-city Senegal + Côte d'Ivoire + Togo, XOF currency |
| Admin operations are first-class | Job runs, announcements, feature flags, coupons all seeded with realistic state |

## Reset between demos

```bash
npm run seed:reset       # confirmation prompt; wipes Firestore
npm run seed             # reload from scratch
```

`seed:reset` (`scripts/seed-reset.ts`) covers **Firestore + Auth + Storage** with a 3-gate confirmation (env target → project ID → typed phrase) and a `--dry-run` mode. See `docs-v2/50-operations/staging-reset.md` for the full operator runbook.

---

## Known seed gaps (Sprint A → D follow-ups)

| Gap | Status | Sprint |
|-----|--------|--------|
| Canonical 22 events lack Wolof titles (synthetic 80 ship full FR/EN/WO) | open follow-up | D follow-up |
| `seed-reset.ts` doesn't touch Storage | tracked | E |
| `seed-reset.ts` doesn't purge Auth users | tracked | E |
| Mobile (Flutter) demo is not part of this script | by design | Wave 9 |

---

## References

- Seed entry point: `scripts/seed-emulators.ts`
- Procedural generator: `scripts/seed/09-rich-dataset.ts`
- Seed coverage report: `docs/seed/coverage-status.md`
- Sprint A audit (origin of these gaps): [`docs/audit-2026-04-25/REPORT.md`](../../docs/audit-2026-04-25/REPORT.md)
