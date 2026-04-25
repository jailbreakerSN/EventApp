# Archive — April 2026

Snapshot of legacy documents that have been **superseded** by canonical references in `docs-v2/` or by newer audits. Kept for historical traceability — these files are immutable; do not edit them.

> If a question is answered both here and in current docs, **current docs win**. If you find yourself relying on something here, file an issue to migrate the canonical content.

## Index

| Archived file | Superseded by | Why archived |
|---|---|---|
| `ux-ui-audit-2026-04-07.md` | `docs/design-system/audit-2026-04-13.md` | Pre-redesign findings; the 2026-04-13 audit is the current source of truth for the design system |
| `system-audit-2026-04-17.md` | `docs/audit-2026-04-25/REPORT.md` | Architecture-wide deep-read; superseded by the comprehensive 2026-04-25 audit (docs + schemas + seed) |
| `delivery-plan-future-roadmap.md` | `docs/delivery-plan/wave-{1..10}-*.md` | Roadmap superseded by the per-wave delivery files which are the active tracking surface |
| `delivery-plan-entitlement-model-design.md` | Implemented; see `docs/delivery-plan/plan-revenue-levers-design.md` + `packages/shared-types/src/organization.types.ts` | Design doc, the model has shipped |
| `delivery-plan-plan-management-phase-7-plus.md` | Folded into `wave-6-payments.md` + `wave-10-launch.md` | Phase concept retired; work absorbed into wave files |
| `admin-overhaul-PLAN.md` | Implemented; see `docs/admin-overhaul/FIDELITY-AUDIT.md` | Design doc, the admin overhaul has shipped (Sprint 4) |

## Conventions

- **Filename rewriting on archive**: when a file moves here from a nested folder (e.g. `docs/delivery-plan/X.md`), rename it on archive so the prefix surfaces the original location (`delivery-plan-X.md`). This keeps the archive flat and avoids name collisions.
- **Never edit** an archived document. Any new statement should be made in current docs and link back to the archive only as historical context.
- **Index updates** in the same PR as the archive move.
