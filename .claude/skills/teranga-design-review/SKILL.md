---
name: teranga-design-review
description: Teranga-specific UX/UI review and implementation guide. Use this skill whenever building or reviewing UI in apps/web-backoffice, apps/web-participant, or packages/shared-ui. It wraps the frontend-design, theme-factory, webapp-testing, and ui-ux-pro-max skills with Teranga's brand, francophone/Senegalese context, African-network constraints, and WCAG 2.1 AA floor. Cite docs/design-system/* as the single source of truth — never propose changes that violate the tokens below.
---

# Teranga Design Review

Teranga is a francophone West African event management platform (web + mobile). The brand is rooted in Senegalese hospitality. Every UI change must respect the constraints below.

## Non-Negotiable Brand Tokens

| Token                | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| `teranga-navy`       | `#1A1A2E` — primary dark / headers                           |
| `teranga-gold`       | `#c59e4b` — accent / CTA (needs darker variant on white)     |
| `teranga-green`      | `#0F9B58` — success / growth                                 |
| `teranga-forest`     | `#2a473c` — dark-mode surface                                |
| Body font            | **Inter** (do not change; `frontend-design` skill advises against Inter — **ignore that suggestion here**) |
| Display font (opt.)  | **DM Sans**                                                  |
| Default locale       | `fr` (French) — `Africa/Dakar` timezone                      |
| Currency             | `XOF` (CFA Franc BCEAO)                                      |

Tokens live in `packages/shared-config/tailwind.config.ts` and are documented in `docs/design-system/design-tokens.md`. **Never redefine tokens in skills or components — always reference the preset.**

## Contextual Constraints

1. **African network conditions** — assume 3G throttling. Every data-fetching view MUST render a skeleton placeholder; images must ship WebP/AVIF with width descriptors.
2. **Francophone-first** — all user-facing strings start in French. Never introduce English-only copy. `next-intl` is installed; until wired, use French literals with a `// i18n: <key>` comment marker.
3. **WCAG 2.1 AA floor** per `docs/design-system/accessibility.md` — contrast, focus ring, keyboard traversal, 44×44 px touch targets, `prefers-reduced-motion` respected.
4. **Dark mode parity** — every new component must be tested in both modes using CSS variables / Tailwind `dark:` utilities, never raw hex.
5. **Multi-tenancy invisible to UI** — never expose `organizationId` in URLs or UI copy; scope is resolved server-side.

## Workflow: Reviewing or Building a UI Change

1. **Read first** — `docs/design-system/README.md`, `design-tokens.md`, `accessibility.md`, `brand-identity.md`, and `docs/ux-ui-audit-2026-04-07.md` for outstanding issues.
2. **Cross-reference skills** as a lens (do not import their brand advice verbatim):
   - `frontend-design` → design-thinking questions (purpose, tone, differentiation); **override** its "avoid Inter" guidance.
   - `ui-ux-pro-max/.claude/skills/ui-ux-pro-max/SKILL.md` → industry rules, anti-patterns, 99 UX guidelines, chart-type fit, empty-state quality. Run `scripts/search.py` under `.claude/skills/ui-ux-pro-max/.claude/skills/ui-ux-pro-max/` with `--design-system` to produce a candidate, then reconcile against our tokens.
   - `theme-factory` → consult only for exploring accent variants within the teranga palette; never replace the palette.
   - `webapp-testing` → run after every structural change to verify mobile breakpoints, focus trap, keyboard flow.
3. **Propose minimal diff** — change the smallest surface that fixes the issue; reuse `packages/shared-ui` before creating new components.
4. **Audit checklist before marking done**:
   - [ ] Tokens from preset (no raw hex)
   - [ ] Dark mode verified
   - [ ] Keyboard-only flow works; focus ring visible
   - [ ] ARIA labels on icon buttons; `aria-current="page"` on active nav; modals have focus trap
   - [ ] Touch targets ≥ 44 px
   - [ ] `prefers-reduced-motion` respected
   - [ ] Skeleton loader for any async view
   - [ ] All new strings in French
   - [ ] Responsive at 375 / 768 / 1280 px
   - [ ] Screen reader announces state changes

## Anti-Patterns (reject on sight)

- Purple/indigo gradients (generic SaaS aesthetic).
- "Inspired-by" replications of Stripe / Linear / Vercel marketing styles — use the Teranga palette.
- Hardcoded hex values or arbitrary Tailwind colors (`bg-gray-900` etc.) outside `confirm-dialog.tsx` migration plan.
- Icon-only buttons without `aria-label`.
- Modals without focus trap and Escape-to-close.
- Currency shown as `$` or `€` — always `Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" })`.
- Skeleton replaced by a bare "Chargement..." string.

## When to Escalate to the User

- Proposed change touches a brand token (palette, typography, radius scale).
- Finding that contradicts `docs/design-system/*` or `docs/ux-ui-audit-2026-04-07.md`.
- Skill recommendation that would require dropping French-first copy.

## Critical Paths

- `packages/shared-ui/src/components/` — single source of reusable components for both apps.
- `apps/web-backoffice/src/components/layouts/sidebar.tsx` — mobile-responsive entry point.
- `apps/web-backoffice/src/app/(dashboard)/layout.tsx` — sidebar host.
- `apps/web-participant/src/app/(auth)/login/login-form.tsx` + matching backoffice path — auth surface.
- Both apps' `src/app/globals.css` — dark-mode variables + motion-reduce.
