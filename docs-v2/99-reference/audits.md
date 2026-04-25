---
title: Audit registry
status: shipped
last_updated: 2026-04-25
---

# Audit registry

Index of all platform-wide audits performed against the Teranga monorepo. Each audit is a dated, immutable snapshot — never edited after publication, only superseded by a newer audit.

> **Where to find them.** Most audits live under `docs/` (legacy location, kept as historical traces) or `docs-v2/` for newer ones. This page is the single index.

## Snapshot audits

| Date | Title | Scope | Verdict | Location |
|------|-------|-------|---------|----------|
| 2026-04-25 | **Documentation, schemas & seed data** — comprehensive audit | Documentation tree, 53 Firestore collections × shared-types × rules × indexes × seed coverage, OpenAPI publication, Storybook gap | A− overall. 8 ADRs to backfill, 6 collections need seed writers, Wolof i18n at 0%, staging-reset misses Storage | [`docs/audit-2026-04-25/REPORT.md`](../../docs/audit-2026-04-25/REPORT.md) |
| 2026-04-21 | Notification system audit | Notification dispatch log, channel adapters, catalog integrity | Shipped | [`docs/notification-audit-2026-04-21.md`](../../docs/notification-audit-2026-04-21.md) |
| 2026-04-20 | Badge journey review | Credential lifecycle from registration to scan, including QR v3/v4 | Shipped | [`docs/badge-journey-review-2026-04-20.md`](../../docs/badge-journey-review-2026-04-20.md) |
| 2026-04-17 | System audit | Architecture-wide deep-read (superseded by 2026-04-25) | Superseded | [`docs/system-audit-2026-04-17.md`](../../docs/system-audit-2026-04-17.md) |
| 2026-04-13 | Design system audit | Tailwind tokens, component patterns, WCAG 2.1 AA | Shipped, gold-dark recalibrated | [`docs/design-system/audit-2026-04-13.md`](../../docs/design-system/audit-2026-04-13.md) |
| 2026-04-07 | UX/UI audit (legacy) | Pre-redesign findings (superseded by design-system audit 2026-04-13) | Superseded | [`docs/ux-ui-audit-2026-04-07.md`](../../docs/ux-ui-audit-2026-04-07.md) (archived) |

## Continuous audits (CI / agents)

These run automatically on every PR and represent the ongoing self-audit posture. Findings are surfaced inline on the PR.

| Audit | Trigger | Owner |
|-------|---------|-------|
| Security review | PR with service / route / rules / upload changes | `.claude/agents/security-reviewer.md` |
| Firestore transaction safety | PR with service edits | `.claude/agents/firestore-transaction-auditor.md` |
| Plan-limit enforcement | PR touching freemium-gated features | `.claude/agents/plan-limit-auditor.md` |
| Domain event emission | PR with mutations | `.claude/agents/domain-event-auditor.md` |
| L10n hardcoded strings | PR with UI changes | `.claude/agents/l10n-auditor.md` |
| Test coverage | PR with service / route / listener / hook / component changes | `.claude/agents/test-coverage-reviewer.md` |
| OpenAPI freshness | PR with route changes | CI step in `api-lint` job |
| Notification catalog integrity | Every PR | CI step in `shared-types` job |
| Seed-data drift | Every PR | CI step in `shared-types` job |
| Lighthouse CI | PR with web-* changes | `.github/workflows/lighthouse-ci.yml` |

## Conventions for new audits

1. Date the file: `audit-YYYY-MM-DD.md` or under `docs/audit-YYYY-MM-DD/REPORT.md`.
2. Lead with an executive summary table (axis, grade, verdict).
3. Lock the scope explicitly; out-of-scope items go in their own section.
4. Find → action → owner: every finding maps to a sprint, a follow-up issue, or an explicit "won't fix".
5. Add a row to this registry in the same PR.
6. Never edit after publication — supersede with a newer audit and mark this one Superseded.

See the 2026-04-25 audit's structure as the canonical template.
