# Teranga Design System

## Overview

This document defines the visual identity, design tokens, component patterns, and UX guidelines for the Teranga event platform. It serves as the **single source of truth** for all design decisions across:

- `apps/web-backoffice/` — Organizer dashboard (Next.js)
- `apps/web-participant/` — Participant web experience (Next.js)
- `apps/mobile/` — Flutter mobile app
- Marketing materials and social assets

**Design principles:**
1. **Teranga (Hospitality)** — warm, welcoming, trustworthy
2. **Francophone-first** — French is the default; all copy, labels, and patterns reflect francophone conventions
3. **Africa-optimized** — fast on low bandwidth, works on older devices, high-contrast for outdoor use
4. **Progressive disclosure** — show what matters first, reveal complexity on demand
5. **Accessible** — WCAG 2.1 AA minimum, touch-friendly, keyboard-navigable

---

## Files in this directory

| File | Purpose |
|------|---------|
| [brand-identity.md](brand-identity.md) | Brand story, logo, name usage, tone of voice |
| [design-tokens.md](design-tokens.md) | Colors, typography, spacing, shadows, radii — the atomic values |
| [component-patterns.md](component-patterns.md) | Reusable UI patterns (buttons, cards, forms, tables, badges, modals) |
| [page-layouts.md](page-layouts.md) | Page structure, navigation, responsive breakpoints |
| [ux-guidelines.md](ux-guidelines.md) | UX patterns for event discovery, registration, dashboards |
| [accessibility.md](accessibility.md) | WCAG compliance, ARIA patterns, touch targets |
| [iconography.md](iconography.md) | Icon library, usage guidelines |
| [audit-2026-04-13.md](audit-2026-04-13.md) | **Current UX/UI audit** — findings, evidence, re-scored dashboard. Supersedes `docs/ux-ui-audit-2026-04-07.md` and `roadmap-2026-04-13.md`. |
| [execution-plan-2026-04-13.md](execution-plan-2026-04-13.md) | **Current P1 backlog** — one task per finding, with acceptance criteria, skill citations, and verification script references. Pair this with the audit. |
| [implementation-plan-2026-04-13.md](implementation-plan-2026-04-13.md) | **Phase 4 orchestration layer** — per-task workflow loop, skill × task matrix, agent × task matrix, phase-based rollout, testing strategy, Definition of Done. Read this before starting any P1 task. |
| [p1-closure-2026-04-14.md](p1-closure-2026-04-14.md) | **P1 closure report** — every P1 task shipped, metrics, deferred residuals, P2 candidates for the next sprint. |
| [roadmap-2026-04-13.md](roadmap-2026-04-13.md) | _Historical_ — 04-13 skills-informed roadmap. Superseded by the audit + execution-plan pair above. Kept for PR #16 traceability. |
