# Data Listing — Doctrine

> Status: **canonical** as of 2026-04-26. Applies to every page that renders a list, grid, or table of records — admin surfaces, participant discovery, and chronological streams. Read this before adding a new search bar, filter, sortable column, or paginated list. Pairs with [`error-handling.md`](./error-handling.md) for the empty/error states it references and with [`accessibility.md`](./accessibility.md) for the ARIA contracts it enforces.

## Why this exists

A 2026-04-26 audit of the three apps and the API surfaced 22 structural gaps in how Teranga renders lists. They cluster into one root cause: **we never wrote the doctrine**. Every page reinvented its own combination of search, filter, sort, pagination, URL state, and empty-state copy, and the divergence is now visible to users:

- The participant `/events` page exposes a **price (free/paid) chip** that persists in the URL but is never sent to the API and was never implemented server-side. The user clicks, nothing changes.
- The same page's text search **breaks past page 1** because `q` is filtered client-side after Firestore returns the page — `meta.totalPages` lies, and page 2 shows results that don't match the query.
- "Sénégal" does not match "Senegal" anywhere in the platform. We are francophone-first and we ignore Unicode normalisation.
- The shared `<DataTable>` component supports zero sortable columns. A super-admin cannot sort users by creation date.
- Refreshing `/admin/users` with a filter active wipes the filter. Sharing a filtered URL on Slack is impossible (except on `/admin/audit`, the one page that got it right).
- `/admin/users` triggers an N+1 against Firebase Auth (one `getUser` per row to compute `claimsMatch`).

This document is the contract every list-rendering surface follows from now on. The primitives that don't yet exist will be built in the order set in [§ application & roadmap](#what-comes-next-step-3); the conventions in this doc apply the moment they ship and retroactively to every page touched in a refactor.

---

## The six dimensions

A "list" is never one thing. It is the product of six independent concerns, and conflating them is what produced the audit findings. Every list page MUST be designed against all six — explicitly choosing "not applicable" is allowed; ignoring a dimension is not.

| # | Dimension          | UX question it answers                                                  | Default we owe the user                                                                                |
| - | ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1 | **Search**         | "How do I find one specific record when I roughly know its name?"       | Debounced (300 ms), accent-folded, server-side, paginated honestly.                                    |
| 2 | **Filter**         | "How do I narrow a large set to a relevant sub-set?"                    | Composable, removable as chips, persisted in the URL, reset to page 1.                                 |
| 3 | **Sort**           | "How do I reorder so what I care about surfaces first?"                 | Click a column header → tri-state cycle (none → asc → desc). `aria-sort` reflects the state.           |
| 4 | **Paginate**       | "How do I navigate 1 000+ records without loading everything?"          | Page-numbered for bounded admin sets, cursor-based for streams. Page-size selector for power users.    |
| 5 | **Persist & share**| "If I send this URL to a colleague, do they see what I see?"            | Yes. Search, filters, sort, page, page size, view mode — all in the URL via `nuqs`.                    |
| 6 | **Recall**         | "Does the app remember the view I work in every day?"                   | For Pro/Enterprise organisers and admins: saved views (search + filters + sort + columns + density).   |

A page that nails dimensions 1–4 but ships without 5 will leak refresh bugs forever. A page with 1–5 but no 6 will exhaust power users into building Notion workarounds. We commit to all six.

---

## The three archetypes

We do not have one kind of list. We have three, and they obey different rules. **Classify a new page before writing a line of code** — the archetype determines the toolbar, the pagination strategy, the URL state shape, and the a11y pattern.

### A. Admin table

> _Operator-facing dense tables: organisers managing events/registrations, super-admins managing users/orgs/audit/coupons._

**Examples (current):** `/events`, `/events/[id]/audience/registrations`, `/admin/users`, `/admin/organizations`, `/admin/audit`, `/admin/events`, `/admin/coupons`, `/admin/plans`, `/admin/jobs`, `/admin/invites`, `/admin/subscriptions`, `/admin/webhooks`, `/admin/api-keys`.

**Identifying traits:**
- Bounded, finite cardinality (hundreds to tens of thousands).
- The user knows what they're looking for or wants to apply a process to a sub-set.
- Bulk actions are common (suspend N users, approve N registrations).
- Density matters more than visual richness. A table is correct.

**Reference benchmarks:** Linear's issue list, Stripe Dashboard tables, Notion database table view, Shopify Polaris `IndexTable`.

### B. Marketplace discovery

> _Public/participant-facing browse-and-find surfaces. Visual, generous, exploratory._

**Examples (current):** `/` and `/events` on `apps/web-participant`. **Future:** organisations directory, speakers directory, `/my-events` saved/upcoming.

**Identifying traits:**
- The user does **not** know exactly what they want; they are browsing.
- Filters are facets they discover, not constraints they specify.
- Cards are the primary visual unit — image, title, price, date, location.
- Tri choosable by user (relevance, date, popularity, distance, price).
- Mobile-first; the search bar lives at the top, filters retreat into a bottom sheet.

**Reference benchmarks:** Airbnb stays search, Eventbrite "find events", Booking.com search results, Meetup discovery.

### C. Stream / inbox

> _Chronological flows that grow continuously. Time is the only sort that matters._

**Examples (current):** event feed (`/events/[slug]/feed`), messages (`/messages`), notifications, audit timeline view.

**Identifying traits:**
- Chronological order is the contract. User-chosen sort is not offered.
- Infinite scroll with a sentinel + a "X new items" banner pattern.
- Filters are minimal and binary (unread, by author, by type).
- Search is optional and post-MVP for most surfaces.
- Read/unread state is visible.

**Reference benchmarks:** Slack threads, Linear inbox, Twitter/X home, GitHub notifications.

---

## Invariants per archetype

Non-negotiable rules. Anything below "MUST" is a code-review blocker; "SHOULD" is the default that requires documented justification to break.

### Admin table — MUST

1. Toolbar layout: `[search] [active filter chips] [+ add filter] · · · [view selector] [density toggle] [export]`.
2. Search is debounced **300 ms** and sent as `?q=` to the server. No client-side post-fetch filtering of `q`.
3. Every column whose underlying field has a Firestore index is **sortable** with `aria-sort` reflecting state.
4. The full state — `q`, every filter, `sort`, `page`, `pageSize`, `view` — lives in the URL via `nuqs`. Refresh reproduces the view exactly.
5. Empty state distinguishes "no data at all" (CTA to create the first record) from "no match for current filters" (CTA "Effacer les filtres").
6. Keyboard: `/` focuses the search, `j/k` navigates rows, `Enter` opens the active row, `?` opens the shortcut help.
7. The header is `position: sticky`. The actions column (if present) is sticky-right on desktop.
8. Page-size selector: `10 / 25 / 50 / 100`. Persisted to the URL **and** to `localStorage` as the user's default.
9. CSV export, when offered, exports the **currently filtered** view, not the unfiltered collection.

### Admin table — SHOULD

10. Bulk selection state survives in-page navigation (drill into detail, browser-back) via `sessionStorage`.
11. Saved views available to Pro/Enterprise organisers and to all super-admins (designed in Step 3).
12. Compact density toggle for power users running 50-row pages.

### Marketplace discovery — MUST

1. Search bar is hero-prominent, sticky on mobile, has an autocomplete dropdown with: top suggestions, recent searches (localStorage, max 5), categorical hints.
2. Active filters render as removable chips above the result grid; a "Tout effacer" button is visible whenever ≥ 1 filter is active.
3. Sort is user-choosable: pertinence (default), date, popularité, prix, proximité (when geoloc available).
4. Mobile: filters open in a Radix-Dialog-backed bottom sheet with a live preview count ("Voir 14 événements") and an "Appliquer" CTA.
5. Result count is announced via `aria-live="polite"` on every change.
6. Empty state suggests **specifically which filter to relax**, never a generic "rien trouvé".
7. URL state is shareable end-to-end (already done on `/events`, must remain so).
8. All comparison and matching is **accent-folded** via `normalizeFr()` (NFD + diacritic strip + lowercase). "Senegal" matches "Sénégal".

### Marketplace discovery — SHOULD

9. View toggle: grid / list. Map view is Phase 3.
10. Image-heavy cards use lazy loading and a low-quality blur placeholder.

### Stream / inbox — MUST

1. Chronological order is the contract; user-chosen sort is not offered.
2. Infinite scroll with `IntersectionObserver` sentinel.
3. New-items banner ("X nouveaux messages") when polling detects upstream changes; clicking it scrolls to top and merges the new items.
4. Loading and end-of-stream states are explicit ("Vous avez tout vu").
5. Filters, when present, are toggle chips (`Unread only`, `Mentions`).

### Stream / inbox — SHOULD

6. Search is post-MVP; when added, it must be server-side and debounced (300 ms).
7. Cursor-based pagination on the API. Total counts are not promised.

---

## Glossary — the words we agree on

| Term                | Means                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Search**          | Free-text input matched against one or more indexed string fields. Always server-side, always debounced, always normalised.                    |
| **Filter**          | A constraint on a structured field (`status = "published"`, `plan IN ["pro", "enterprise"]`). Composable, removable, never silent.             |
| **Facet**           | A filter whose available values are derived from the result set (e.g. "Catégories disponibles : Conférence (12), Atelier (3)"). Phase 3.       |
| **Sort**            | A user-chosen ordering on one (or many — Phase 3) columns. Tri-state on click: `none → asc → desc → none`.                                     |
| **View**            | The full state tuple `(q, filters, sort, page, pageSize, columns, density)`. The URL is a view; a saved view is one of those snapshotted.      |
| **Saved view**      | A named view persisted per user (admin tables only, gated for Pro/Enterprise organisers). Restorable in one click.                             |
| **Search keywords** | The dénormalised `searchKeywords: string[]` field we maintain on indexable documents. Holds normalised n-grams; queried with `array-contains`. |
| **Page**            | An offset-based slice of the result set. Used for bounded admin tables only.                                                                   |
| **Cursor**          | A stable opaque token (`startAfter` doc snapshot, base64-encoded) used for streams and large discovery sets.                                   |
| **Empty state**     | The canonical "nothing to show" UI — distinct copy for "no data" vs "no match", per [`error-handling.md`](./error-handling.md).                |
| **Bulk action**     | An operation applied to a multi-selected row set, gated behind a confirmation dialog and audited row-by-row server-side.                       |
| **Bottom sheet**    | A modal that slides up from the bottom on mobile. Backed by Radix `Dialog` with the `bottom-sheet` variant.                                    |

---

## References

The doctrine in this document is opinionated, but the opinions are calibrated against external benchmarks. When in doubt, these are the houses we look to:

- **WCAG 2.1 AA** — accessibility floor. Specifically: `aria-sort`, `aria-live="polite"` for dynamic counts, `aria-expanded` on filter disclosures, focus-visible rings.
- **W3C ARIA Authoring Practices Guide (APG)** — patterns we implement: `combobox` for autocomplete, `listbox` for filter dropdowns, `grid` for keyboard-navigable tables, `dialog` for the bottom sheet.
- **Shopify Polaris `IndexFilters` + `IndexTable`** — closest off-the-shelf doctrine to what we are building. Naming conventions and "filter pill" UX adopted with light edits.
- **Linear** — keyboard-first interaction model on admin lists (`j/k/Enter/Esc/?`).
- **Stripe Dashboard** — filter chip composability, URL state discipline, CSV export semantics.
- **Notion database views** — saved-view UX (named views, default per user, shareable).
- **Airbnb / Eventbrite / Booking.com** — discovery patterns, mobile bottom sheet, sticky search bar, count-driven CTAs.
- **GOV.UK Design System** — accessibility-first phrasing, especially for empty/error copy.

We do **not** mimic any of these slavishly. Brand tokens are locked to [`brand-identity.md`](./brand-identity.md); the doctrine here governs **structure and behaviour**, not visual style.

---

## What comes next (Steps 2 & 3)

This is Step 1 of 3 — the conceptual layer. It establishes the vocabulary, the archetypes, and the invariants. Two more documents complete the doctrine:

- **Step 2 — Technical contracts** (in this file, appended below): the frontend primitives (`useTableState`, `<DataTable>` v2 column contract, `<FilterBar>`, `normalizeFr`, mobile bottom-sheet pattern), backend primitives (`PaginationSchema`, `searchKeywords[]` write/read flow, soft-delete default, cursor pagination, response shape), and Firestore data conventions (index hygiene, denormalisation rules, precomputed counters).
- **Step 3 — Application** (in this file, appended below): one full code skeleton per archetype, the saved-views design for Pro/Enterprise organisers, a page-by-page migration playbook from current state to doctrine, the P0 → P3 roadmap, and the open-decisions journal.

Until Steps 2 and 3 land, **do not** create new list pages. Refactor existing ones only with the author of this document.
