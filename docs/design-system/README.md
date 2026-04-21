# Teranga Design System

> ### Editorial v2 — 2026-04-17
>
> The **Teranga Participant** prototype (Claude Design bundle, `Teranga Participant.html` entry) is now the canonical visual reference. The participant web app (`apps/web-participant`) has been reworked against it — Discovery, Event detail, Registration wizard, My Events, Badge page are all live on editorial treatments. Every new surface MUST read these docs before touching pixels; backoffice + mobile are next.
>
> **What changed in v2:** Fraunces serif for display, JetBrains Mono for kickers, new brand tokens (`navy-2/-3`, `gold-soft/whisper`, `clay`), three new radii (`card` 14 / `tile` 20 / `pass` 22), the `.teranga-cover` / `.teranga-hero-texture` / `.teranga-pulse-dot` utilities, and an 8-palette cover gradient rotation (`getCoverGradient(event.id)`). Pills are default `rounded-full`, CTAs `bg-teranga-navy` on light and `bg-teranga-gold` on dark. See [design-tokens.md](design-tokens.md) for the full list.

## Overview

This document defines the visual identity, design tokens, component patterns, and UX guidelines for the Teranga event platform. It serves as the **single source of truth** for all design decisions across:

- `apps/web-backoffice/` — Organizer dashboard (Next.js)
- `apps/web-participant/` — Participant web experience (Next.js) — **Editorial v2 live**
- `apps/mobile/` — Flutter mobile app
- Marketing materials and social assets

**Design principles:**

1. **Teranga (Hospitality)** — warm, welcoming, trustworthy.
2. **Francophone-first** — French is the default; all copy, labels, and patterns reflect francophone conventions. Fraunces italic in gold carries the editorial voice.
3. **Africa-optimized** — fast on low bandwidth (variable fonts lazy-loaded, pure-CSS cover textures, no imagery for fallbacks), high-contrast for outdoor use, offline-first badges.
4. **Editorial, not generic SaaS** — magazine-style hierarchy (mono kicker → serif title → body), asymmetric grids, tactile ticket metaphors.
5. **Progressive disclosure** — show what matters first, reveal complexity on demand.
6. **Accessible** — WCAG 2.1 AA minimum, focus-visible gold ring, `prefers-reduced-motion` respected globally.

---

## Files in this directory

| File                                                                   | Purpose                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [brand-identity.md](brand-identity.md)                                 | Brand story, logo, name usage, tone of voice                                                                                                                                                            |
| [design-tokens.md](design-tokens.md)                                   | Colors, typography, spacing, shadows, radii — the atomic values                                                                                                                                         |
| [component-patterns.md](component-patterns.md)                         | Reusable UI patterns (buttons, cards, forms, tables, badges, modals)                                                                                                                                    |
| [page-layouts.md](page-layouts.md)                                     | Page structure, navigation, responsive breakpoints                                                                                                                                                      |
| [ux-guidelines.md](ux-guidelines.md)                                   | UX patterns for event discovery, registration, dashboards                                                                                                                                               |
| [accessibility.md](accessibility.md)                                   | WCAG compliance, ARIA patterns, touch targets                                                                                                                                                           |
| [iconography.md](iconography.md)                                       | Icon library, usage guidelines                                                                                                                                                                          |
| [error-handling.md](error-handling.md)                                 | **Error UX reference** — channel selection (toast / banner / field / blocking state), API code contract, `details.reason` disambiguation, observability hook. Read before adding any new mutation flow. |
| [audit-2026-04-13.md](audit-2026-04-13.md)                             | **Current UX/UI audit** — findings, evidence, re-scored dashboard. Supersedes `docs/ux-ui-audit-2026-04-07.md` and `roadmap-2026-04-13.md`.                                                             |
| [execution-plan-2026-04-13.md](execution-plan-2026-04-13.md)           | **Current P1 backlog** — one task per finding, with acceptance criteria, skill citations, and verification script references. Pair this with the audit.                                                 |
| [implementation-plan-2026-04-13.md](implementation-plan-2026-04-13.md) | **Phase 4 orchestration layer** — per-task workflow loop, skill × task matrix, agent × task matrix, phase-based rollout, testing strategy, Definition of Done. Read this before starting any P1 task.   |
| [p1-closure-2026-04-14.md](p1-closure-2026-04-14.md)                   | **P1 closure report** — every P1 task shipped, metrics, deferred residuals, P2 candidates for the next sprint.                                                                                          |
| [roadmap-2026-04-13.md](roadmap-2026-04-13.md)                         | _Historical_ — 04-13 skills-informed roadmap. Superseded by the audit + execution-plan pair above. Kept for PR #16 traceability.                                                                        |
