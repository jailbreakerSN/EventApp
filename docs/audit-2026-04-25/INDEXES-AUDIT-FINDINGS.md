---
title: Indexes audit findings (Sprint C.4)
status: shipped
last_updated: 2026-04-25
audience: maintainers
parent: REPORT.md
---

# Sprint C.4 — Firestore indexes audit results

> **Sprint A speculated** that `notificationDispatchLog.metadata.audience.role` (a nested-field index) needed validation in production. Sprint C.4 ran the existing audit script and read the source. Findings below.

## Result

```
✅ All primary (maximal + mandatory-only) query shapes covered.
   165 subset warning(s).
```

The 165 warnings are **subset variants** — combinations of optional filters from the public events search (`category` × `format` × `isFeatured` × `location.city` × `location.country` × `organizationId` × `tags`). They are advisories: each variant would benefit from a dedicated composite index, but they don't fail any production query. The primary maximal-fields index covers all of them at the cost of a slower fan-out on rarer combinations.

This is the same posture the script reports today on `develop` and is enforced under `npm run audit:firestore-indexes:strict` (already wired into CI).

## Speculated `metadata.audience.role` index

Searched: 0 references across `apps/api/src/services/`, `apps/api/src/repositories/`, and `infrastructure/firebase/firestore.indexes.json`. The audience-routing logic in `notification-dispatcher.service.ts` keys on `recipientRef` + `attemptedAt`, both of which already have composite indexes. The Sprint A audit's concern was speculative — no action needed.

## Action items

| # | Decision | Why |
|---|---------|-----|
| 1 | Keep all 165 subset advisories as-is | Cost of dedicated indexes outweighs the minor query speedup; primary index covers all paths |
| 2 | Skip the `metadata.audience.role` index | Code never queries on that path |
| 3 | Sprint C.4 closes with no rule changes | Existing CI strict mode already gates this |

## Reproduction

```bash
npm run audit:firestore-indexes              # advisory mode (current)
npm run audit:firestore-indexes:strict       # CI mode (fails on subset warnings)
```

## Related

- [`REPORT.md`](./REPORT.md) — Sprint A audit, §3.2 was the source of this concern
- `scripts/audit-firestore-indexes.ts` — the script itself
- `infrastructure/firebase/firestore.indexes.json` — composite index manifest (114 entries)
