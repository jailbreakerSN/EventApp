# Teranga UX/UI Execution Plan — P1 Backlog

**Date:** 2026-04-13
**Scope:** P1 (HIGH) items only — one task per finding. P2 listed briefly at the end as follow-up.
**Companion doc:** `audit-2026-04-13.md` — read it first for evidence and severity.
**Branch model:** one task = one feature branch. Pick from the top of §Sequencing, ship, open PR, repeat.

Every task uses the template below. A subsequent branch picking up any task should **not** need to re-audit.

> **Template**
>
> ```
> ### TASK-P1-<id> — <title>
> Priority: P1 | Estimated effort: S/M/L | Dependencies: <task-ids or none>
> Skill citation: <skill> <rule>
> Files:
>   - <path> (<nature of change>)
> Acceptance criteria:
>   - [ ] <criterion>
> Verification: scripts/design-verification/<script>.py
> ```

---

## Sequencing

Low-risk, unblocks-visual-regressions items first. Order recommended for execution:

1. **TASK-P1-H8** — Skeleton coverage completion (small, mechanical)
2. **TASK-P1-H7** — Badge call-site dark-mode sweep (small, mechanical)
3. **TASK-P1-N4** — Toast breakpoint-aware placement (trivial)
4. **TASK-P1-N2** — Empty-state migration (medium — 2 call-sites → many)
5. **TASK-P1-H3** — onBlur validation unification (medium — RHF refactor in participant)
6. **TASK-P1-H1** — Chip-based discovery filters (medium)
7. **TASK-P1-H2** — Event-detail tabs (medium)
8. **TASK-P1-N3** — Chart delta a11y (small)
9. **TASK-P1-H4** — DataTable migration (large — 16 call-sites; split per-page)
10. **TASK-P1-H6** — Email-verification hard gate (medium — server + client)
11. **TASK-P1-I1** — next-intl wiring + shared-UI extraction (large — separate Wave if needed)

`H4` and `I1` are the only items that may need splitting into sub-PRs; sub-splits are called out inline.

---

## Tasks

### TASK-P1-H8 — Skeleton coverage completion

Priority: P1 | Estimated effort: S | Dependencies: none
Skill citation: `ui-ux-pro-max` rule 41 (perceived-performance — content-shape skeletons > loading text)
Files:
  - `apps/web-backoffice/src/app/(dashboard)/events/[eventId]/page.tsx` (replace "Chargement" text)
  - `apps/web-backoffice/src/app/(dashboard)/admin/layout.tsx` (replace)
  - `apps/web-backoffice/src/app/(dashboard)/badges/page.tsx` (replace)
  - `apps/web-backoffice/src/app/(dashboard)/layout.tsx` (line 115 `BrandedLoader` is OK; keep — but audit nested "Chargement" text)
  - `apps/web-backoffice/src/app/loading.tsx` (replace)
  - `apps/web-participant/src/app/(authenticated)/events/[slug]/feed/page.tsx` (replace)
  - `apps/web-participant/src/app/(authenticated)/speaker/[eventId]/page.tsx` (replace)
  - `apps/web-participant/src/app/(authenticated)/sponsor/[eventId]/page.tsx` (replace)
  - `apps/web-participant/src/app/loading.tsx` (replace)
  - `apps/web-participant/src/components/feed/InfiniteScrollSentinel.tsx` (replace with inline `Skeleton`)
Acceptance criteria:
  - [ ] `grep -rln 'Chargement' apps/web-*/src/` returns **0 files** (or only `BrandedLoader` legitimate uses where no content shape exists)
  - [ ] Every replaced site uses `Skeleton` from `@teranga/shared-ui` with a shape that approximates the final content (card, row, avatar)
  - [ ] `prefers-reduced-motion: reduce` disables the pulse animation (global rule already in place — verify no regression)
Verification: `scripts/design-verification/verify_skeleton_coverage.py`

---

### TASK-P1-H7 — Badge call-site dark-mode sweep

Priority: P1 | Estimated effort: S | Dependencies: none
Skill citation: `theme-factory` — dark-mode contrast ≥ 4.5 : 1; Teranga brand token lock
Files (by instance count — do top 5, verify 100 % across the 31):
  - `apps/web-backoffice/src/app/(dashboard)/events/[eventId]/page.tsx` (26 hardcoded bg-*)
  - `apps/web-backoffice/src/app/(dashboard)/events/[eventId]/checkin/page.tsx` (10)
  - `apps/web-participant/src/app/(public)/events/[slug]/page.tsx` (8)
  - `apps/web-backoffice/src/app/(dashboard)/organization/page.tsx` (5)
  - `apps/web-backoffice/src/app/(dashboard)/notifications/page.tsx` (3)
  - (remaining 26 files with 1–3 occurrences each)
Acceptance criteria:
  - [ ] All `bg-emerald-*` / `bg-amber-*` / `bg-red-*` / `bg-green-*` **on Badge call-sites** replaced with semantic Badge variants (`success`, `warning`, `destructive`, `info`) or semantic tokens (`bg-success`, `text-destructive`, …)
  - [ ] `grep -rln 'bg-emerald\|bg-amber\|bg-red\|bg-green' apps/web-*/src/` is **≤ 5 files** (legitimate non-Badge uses: feed post indicators, payment-status cards — documented inline)
  - [ ] Visual parity confirmed in light + dark themes at 375 / 768 / 1280 px via verification script
Verification: `scripts/design-verification/verify_badge_darkmode.py`

---

### TASK-P1-N4 — Toast breakpoint-aware placement

Priority: P1 | Estimated effort: S | Dependencies: none
Skill citation: `ui-ux-pro-max` rule 55 (toast placement — top-center on `< sm`)
Files:
  - `packages/shared-ui/src/components/toaster.tsx` (single source; both apps consume)
Acceptance criteria:
  - [ ] `position` switches from `bottom-right` (≥ 640 px) to `top-center` (< 640 px) via `window.matchMedia` + state, or via Sonner's responsive API if available
  - [ ] On mobile, toast does not overlap sticky CTAs or the email-verification banner
  - [ ] SSR-safe (no hydration mismatch — default to desktop position, upgrade on mount)
  - [ ] `aria-label="Notifications"` preserved
Verification: `scripts/design-verification/verify_toast_placement.py`

---

### TASK-P1-N2 — Empty-state migration

Priority: P1 | Estimated effort: M | Dependencies: none
Skill citation: `ui-ux-pro-max` rule 62 (empty-state must carry illustration + primary CTA)
Files (audit each — 2 existing + ~20 candidates):
  - `apps/web-backoffice/src/app/(dashboard)/finance/page.tsx` ("Aucun versement pour le moment" → add CTA "Configurer les versements")
  - `apps/web-backoffice/src/app/(dashboard)/events/page.tsx` (no events → "Créer mon premier événement")
  - `apps/web-backoffice/src/app/(dashboard)/notifications/page.tsx` (empty feed)
  - `apps/web-participant/src/app/(authenticated)/my-events/page.tsx` (empty registrations → "Explorer les événements")
  - `apps/web-participant/src/app/(authenticated)/events/[slug]/feed/page.tsx` (empty feed)
  - `apps/web-backoffice/src/app/(dashboard)/events/[eventId]/page.tsx` (empty sessions, speakers, sponsors — 3 sites)
Acceptance criteria:
  - [ ] Every list page that can render zero items uses `EmptyState` from `shared-ui`
  - [ ] Each `EmptyState` has: icon/illustration, French heading, French body (1 sentence), primary CTA button with action
  - [ ] CTA navigates or opens a dialog to resolve the empty state
  - [ ] Dark-mode tokens respected
  - [ ] `grep -rln 'EmptyState\|empty-state' apps/web-*/src/` goes from 2 → ≥ 10 files
Verification: `scripts/design-verification/verify_empty_states.py`

---

### TASK-P1-H3 — `onBlur` validation unification

Priority: P1 | Estimated effort: M | Dependencies: none
Skill citation: `frontend-design` — *never leave the user guessing*; RHF `mode: "onBlur"` as the floor
Files:
  - `apps/web-participant/src/app/(auth)/register/register-form.tsx` (migrate from hand-rolled state to RHF + Zod resolver)
  - `apps/web-backoffice/src/app/(dashboard)/events/new/page.tsx` (add RHF `mode: "onBlur"`, success-state affordances)
  - `apps/web-backoffice/src/app/(dashboard)/venues/[venueId]/page.tsx` (same)
  - `apps/web-backoffice/src/app/(dashboard)/organization/page.tsx` (same)
  - `packages/shared-ui/src/components/form-field.tsx` (add `state="valid" | "error" | "idle"` prop with green-check icon when valid)
Acceptance criteria:
  - [ ] All public-facing forms use RHF `mode: "onBlur"` (register, login, event create/edit, venue, organization, settings)
  - [ ] `FormField` renders a green-check icon when `state="valid"` (and `Input` exposes `aria-invalid`/`aria-describedby` correctly)
  - [ ] `grep -rln 'mode:\s*"onBlur"' apps/web-*/src/` returns **≥ 6 files** (from 1 today)
  - [ ] Error messages appear on blur (not only on submit) and are `role="alert"`
Verification: `scripts/design-verification/verify_onblur_validation.py`

---

### TASK-P1-H1 — Chip-based event discovery filters

Priority: P1 | Estimated effort: M | Dependencies: none
Skill citation: `ui-ux-pro-max` rule 12 (discovery — chips beat dropdowns on mobile)
Files:
  - `apps/web-participant/src/components/event-filters.tsx` (replace `<Select>` for date and price with chip rows)
  - `apps/web-participant/src/app/(public)/events/page.tsx` (no structural change — consumes the filter component)
  - `packages/shared-ui/src/components/chip.tsx` (NEW — if not added as part of this task, reuse Button `variant="outline"` with `aria-pressed`)
Acceptance criteria:
  - [ ] Date filter becomes chip row: **Aujourd'hui / Cette semaine / Ce weekend / Ce mois**
  - [ ] Price filter becomes chip row: **Gratuit / < 10 000 XOF / 10–50 k / > 50 k**
  - [ ] Selected chip has `aria-pressed="true"`, teranga-gold border, and is keyboard-focusable
  - [ ] Filter state syncs to URL search params (`?date=weekend&price=lt10k`)
  - [ ] Chip row horizontally scrolls on `< 640 px` with `scroll-snap-type: x mandatory` and fade mask
  - [ ] City, category, format remain as `<Select>` (not discovery-critical on mobile)
  - [ ] "Effacer" button clears all filters
Verification: `scripts/design-verification/verify_discovery_chips.py`

---

### TASK-P1-H2 — Event-detail tab navigation

Priority: P1 | Estimated effort: M | Dependencies: none
Skill citation: `ui-ux-pro-max` rule 29 (reduce decision fatigue) + chart a11y rule 78
Files:
  - `apps/web-participant/src/app/(public)/events/[slug]/page.tsx` (refactor from vertical scroll to tabbed layout)
  - Potentially extract sections into components: `event-detail/tabs/{about,speakers,sessions,sponsors,practical}.tsx`
Acceptance criteria:
  - [ ] Tabs implemented via `<Tabs>` from `shared-ui`: **À propos / Intervenants / Sessions / Sponsors / Pratique**
  - [ ] Active tab persists via URL hash or `?tab=sessions` search param
  - [ ] On `< 640 px` the tab list horizontally scrolls with `scroll-snap-type: x mandatory` and fade mask
  - [ ] Keyboard: arrow keys move between tabs; Enter activates; Tab exits into content
  - [ ] `aria-selected` on the active tab; `role="tabpanel"` on content
  - [ ] SSR: the active tab's panel is server-rendered (for SEO); others hydrate client-side
  - [ ] JSON-LD and share buttons remain visible above the tab strip
Verification: `scripts/design-verification/verify_detail_tabs.py`

---

### TASK-P1-N3 — Chart delta accessibility

Priority: P1 | Estimated effort: S | Dependencies: none
Skill citation: `ui-ux-pro-max` rule 78 (charts — never rely on color alone)
Files:
  - `apps/web-backoffice/src/app/(dashboard)/analytics/page.tsx` (delta pills)
  - `apps/web-backoffice/src/app/(dashboard)/dashboard/page.tsx` (trend cards)
  - Possibly extract: `packages/shared-ui/src/components/delta-pill.tsx` (NEW)
Acceptance criteria:
  - [ ] Every delta indicator uses: **color + glyph (▲/▼/―) + textual sign ("+12 %", "−3 %")**
  - [ ] Positive = `teranga-green`, negative = `teranga-gold` (avoid red/green confusion for deuteranopia)
  - [ ] Delta pills pass 4.5 : 1 contrast in both light and dark themes
  - [ ] Screen-reader announces "Hausse de 12 pour cent" / "Baisse de 3 pour cent" via `aria-label`
Verification: `scripts/design-verification/verify_chart_delta.py` (visual + axe a11y check)

---

### TASK-P1-H4 — DataTable migration

Priority: P1 | Estimated effort: L | Dependencies: none — **split into 4 sub-PRs**
Skill citation: `ui-ux-pro-max` rule 58 (data density — sortable, selectable, responsive)
Split:
  - **H4a — admin tables** (5 files): `admin/{events,audit,users,venues,organizations}/page.tsx`
  - **H4b — event detail + check-in** (3 files): `events/[eventId]/page.tsx`, `events/[eventId]/checkin/page.tsx`, `events/[eventId]/checkin/history/page.tsx`
  - **H4c — finance + analytics + dashboard** (4 files): `finance/page.tsx`, `analytics/page.tsx`, `dashboard/page.tsx`, `events/page.tsx`
  - **H4d — participant-side** (3 files): `events/compare/page.tsx`, `sponsor/[eventId]/page.tsx`, `venues/[venueId]/page.tsx`
  - **Excluded:** `PlanComparisonTable.tsx` — semantic table for pricing comparison, leave as raw `<table>` with proper `<th scope>`.
Acceptance criteria (per sub-PR):
  - [ ] Every migrated page uses `DataTable` from `shared-ui`
  - [ ] Sorting on at least one column (typically "Date" or "Status")
  - [ ] Responsive: on `< 768 px`, table either horizontally scrolls OR collapses to card layout (DataTable's built-in mode)
  - [ ] Sticky header on `≥ 768 px`
  - [ ] Pagination via `Pagination` component if `> 20` rows
  - [ ] Bulk-select where actions apply (e.g. registrations — "Confirmer sélection")
Verification: `scripts/design-verification/verify_datatable_migration.py` (parameterised by sub-PR scope)

---

### TASK-P1-H6 — Email-verification hard gate

Priority: P1 | Estimated effort: M | Dependencies: none
Skill citation: n/a (product-integrity gap) — supersedes the advisory banner (shipped 04-13)
Files:
  - `apps/web-backoffice/src/hooks/use-auth.tsx` (expose `requireEmailVerified` helper)
  - `apps/web-backoffice/src/app/(dashboard)/layout.tsx` (add gate — redirect to `/verify-email` if `!emailVerified` **after 7-day grace period**)
  - `apps/web-backoffice/src/app/(auth)/verify-email/page.tsx` (NEW if not present; participant has one — port it)
  - `apps/web-backoffice/src/middleware.ts` (optional — server-side redirect for direct URL access)
Acceptance criteria:
  - [ ] Users with `emailVerified === false` AND `createdAt > 7 days ago` are redirected to `/verify-email` on any dashboard route
  - [ ] Grace period configurable via `NEXT_PUBLIC_EMAIL_GRACE_DAYS` env (default 7)
  - [ ] `/verify-email` page shows: current email, "Renvoyer l'email" button, "J'ai vérifié — rafraîchir" button (calls `getIdToken(true)`)
  - [ ] During grace period, banner remains at `(dashboard)/layout.tsx:63` — **do not double-show**
  - [ ] Super-admins are exempt (documented)
  - [ ] **Security note:** this is a UX gate — the API already enforces `emailVerified` on sensitive mutations via custom claims. Do not remove API-side checks.
Verification: `scripts/design-verification/verify_email_gate.py` — emulator-based, uses Firebase Auth emulator to simulate both verified and unverified states

---

### TASK-P1-I1 — next-intl wiring + extraction

Priority: P1 | Estimated effort: L | Dependencies: **split; shared-ui first unblocks all consumers**
Skill citation: CLAUDE.md §Localization (fr default, en + wo secondary)
Split:
  - **I1a — shared-ui extraction (highest leverage)**: extract all hardcoded `aria-label`s and UI strings from the 6 shared-ui components flagged by l10n-auditor (`pagination.tsx`, `dialog.tsx`, `search-input.tsx`, `file-upload.tsx`, `toaster.tsx`, + one more). Accept `t` prop or use `next-intl` server helpers if SSR-compatible.
  - **I1b — i18n provider wiring**: wire `NextIntlClientProvider` in both `app/layout.tsx`, add language selector in topbar (backoffice) + footer (participant). Default to `fr`, persist choice in cookie.
  - **I1c — top-10 offender extraction**: migrate the 10 worst files (see audit §5). Stub `en.json` keys; leave `wo.json` as empty-object stubs with a `TODO(wolof)` comment.
  - **I1d — long-tail extraction**: remaining 73 files. Mechanical but volume-heavy — should be its own branch (treat as mini-Wave).
Acceptance criteria (I1a + I1b — gate for shipping I1c/I1d):
  - [ ] Zero hardcoded strings in `packages/shared-ui/src/components/`
  - [ ] `messages/fr.json`, `messages/en.json`, `messages/wo.json` exist in both apps
  - [ ] Language selector switches locale without reload; cookie persists
  - [ ] `lang={locale}` on `<html>` (not hardcoded `"fr"`)
  - [ ] Build succeeds; RSC and client components both consume translations
Acceptance criteria (I1c + I1d):
  - [ ] `grep -rln 'useTranslations\|getTranslations' apps/web-*/src/` covers **≥ 50 files**
  - [ ] `fr.json` key count ≥ 450 per app
  - [ ] `en.json` keys mirror `fr.json` (can be auto-translated for P1; human QA in P2)
  - [ ] `wo.json` keys present with `TODO(wolof)` values (translation sourcing is a separate task)
Verification: `scripts/design-verification/verify_i18n_coverage.py` (enforces key-count floor; no runtime hardcoded strings via Playwright text comparison across `?lang=fr` vs `?lang=en`)

**Security note:** no security implications — i18n is read-only.

---

## P2 follow-up (one-liners only)

From 04-07 audit, no change in scope:

| ID | One-liner                                                                                            |
| -- | ---------------------------------------------------------------------------------------------------- |
| M1 | Breadcrumb component adoption audit across nested admin pages                                        |
| M2 | Avatar fallback consistency (initials, background colour)                                            |
| M3 | Dashboard trend indicators → sparkline + delta pill (ties with N3 — can be merged)                   |
| M4 | Tooltip adoption on icon-only buttons across both apps                                               |
| M5 | Rich-text editor (tiptap or lexical) for event descriptions                                          |
| M6 | File-upload progress + drag-drop polish (today: basic `<input type="file">`)                         |
| M7 | Keyboard shortcuts discoverability (shortcuts dialog exists — add `?` FAB on mobile)                 |
| M8 | Search-input debounce standardisation (today: inconsistent 300/500 ms)                               |
| M9 | Similar-events horizontal snap-scroll row (participant event detail)                                 |
| M10| `OfflineBanner` UX — today shipped; audit message copy & retry affordance                            |

P2 items do not require verification scripts until promoted to P1.

---

## Definition of Done (any task)

Before marking a task complete:

1. Acceptance criteria all `[x]`
2. Verification script runs green locally
3. Manual smoke test at 375 / 768 / 1280 px, light + dark theme
4. `l10n-auditor` re-run shows no regression (no new hardcoded strings introduced)
5. Commit follows CLAUDE.md §Conventional Commits (type, scope, body with *why*, test status)
6. PR description updated on every push to match cumulative scope
7. No code changes in `apps/api/` or `apps/functions/` — these are UI tasks
