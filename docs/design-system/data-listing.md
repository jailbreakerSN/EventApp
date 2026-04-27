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
4. Mobile: filters open in a native-`<dialog>`-backed bottom sheet with a live preview count ("Voir 14 événements") and an "Appliquer" CTA.
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
| **Bottom sheet**    | A modal that slides up from the bottom on mobile. Backed by the native `<dialog>` element (focus trap + ESC + backdrop for free, no extra dep). |

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

# Step 2 — Technical contracts

The previous section described **what** the user receives. This section describes **how** the code delivers it. Every primitive named here is the only sanctioned way to satisfy its dimension; ad-hoc reinvention is a code-review blocker.

## Frontend primitives

### `useTableState<TFilters>` — the single source of URL state

Lives in `apps/web-backoffice/src/hooks/use-table-state.ts` (and a mirror in `apps/web-participant/src/hooks/`). Backed by [`nuqs`](https://github.com/47ng/nuqs). One hook per page. **No page reads `searchParams` or calls `router.push` directly for list state.**

```ts
type SortState<TField extends string = string> = { field: TField; dir: "asc" | "desc" } | null;

type UseTableStateOptions<TFilters extends Record<string, unknown>> = {
  /** Page-scoped namespace for URL keys, e.g. "events" → ?events.q=…. Required when 2+ tables coexist. */
  urlNamespace?: string;
  /** Defaults applied when a key is absent from the URL. */
  defaults: {
    sort?: SortState;
    pageSize?: 10 | 25 | 50 | 100;
    filters?: Partial<TFilters>;
  };
  /** Whitelist of sortable fields. Anything outside is rejected (silently → defaults.sort). */
  sortableFields: readonly string[];
  /** Whitelist of filter keys + their parsers (nuqs parsers). */
  filterParsers: { [K in keyof TFilters]: import("nuqs").Parser<TFilters[K]> };
  /** Debounce for `q` only, in ms. Default 300. */
  debounceMs?: number;
};

type UseTableStateResult<TFilters> = {
  q: string;                      // raw input value (controlled)
  debouncedQ: string;             // debounced — pass this to the server query
  filters: TFilters;
  sort: SortState;
  page: number;                   // 1-indexed
  pageSize: 10 | 25 | 50 | 100;
  activeFilterCount: number;      // for chip badge / mobile "Filtres (3)"
  setQ: (next: string) => void;
  setFilter: <K extends keyof TFilters>(key: K, value: TFilters[K] | undefined) => void;
  toggleSort: (field: string) => void;  // tri-state cycle
  setPage: (next: number) => void;
  setPageSize: (next: 10 | 25 | 50 | 100) => void;
  reset: () => void;              // clears every URL key in the namespace
};
```

**Behavioural contract:**

1. **Reset semantics** — any change to `q`, `filters`, `pageSize`, or `sort` resets `page` to 1. `setPage` itself does not.
2. **Debounce** — only `q` is debounced. Filter and sort changes fire immediately. The hook returns both `q` (controlled, immediate) and `debouncedQ` (server query input).
3. **Validation** — sort fields outside `sortableFields` are rejected. `pageSize` outside the whitelist falls back to the default. Filter values that fail their parser are dropped silently.
4. **`pageSize` persistence** — `pageSize` reads from URL first, then `localStorage[<namespace>:pageSize]` second, then `defaults.pageSize`. Setting `pageSize` writes both. This gives shareable URLs **and** a sticky personal default.
5. **`reset()`** — wipes every key in the namespace from the URL in one history entry. `q` clears immediately (no debounce flicker).
6. **No double-encoding** — the page passes `debouncedQ`, `filters`, `sort`, `page`, `pageSize` straight to the API client. The hook does not transform names.

### `<DataTable>` v2 — column contract

Extends the existing `packages/shared-ui/src/components/data-table.tsx`. Backwards-compatible with the v1 column shape; new fields are additive.

```ts
type DataTableColumn<T, TSortField extends string = string> = {
  key: string;
  header: string | ReactNode;
  render: (row: T) => ReactNode;
  /** Existing v1 fields */
  primary?: boolean;
  hideOnMobile?: boolean;
  stopRowNavigation?: boolean;
  /** New in v2 */
  sortable?: boolean;             // shows the chevron + makes the header a button
  sortField?: TSortField;         // server-side sort key, defaults to `key`
  align?: "left" | "right" | "center";
  width?: number | "auto";
  sticky?: "left" | "right";      // sticky column on desktop only
  ariaLabel?: string;             // overrides the visible header for SR (e.g. icon-only column)
};

type DataTableProps<T> = {
  // … v1 props preserved …
  density?: "compact" | "comfortable";  // default: "comfortable"
  sort?: SortState;                      // controlled — comes from useTableState
  onToggleSort?: (field: string) => void;
  stickyHeader?: boolean;                // default: true on admin tables
};
```

**Behavioural contract:**

1. **Tri-state header click** — the cycle is `null → asc → desc → null`. The first click sets `asc`. `aria-sort` attribute is set on the `<th>` to `none | ascending | descending`, never omitted.
2. **Visual indicator** — chevron-up (asc), chevron-down (desc), faded chevron-up-down (sortable but inactive). Active sort header gets `font-semibold` and the brand gold underline.
3. **Sticky header** — `position: sticky; top: 0` on `<thead>` with `bg-card` and `z-10`. Disabled on mobile cards layout (no header).
4. **Sticky column** — `position: sticky; left|right: 0` on the `<th>` and `<td>`. Box-shadow indicates the seam. Disabled on mobile.
5. **Density** — `comfortable` = `py-3 px-4`. `compact` = `py-2 px-3 text-sm`. The toggle persists to `localStorage[<namespace>:density]`.
6. **Loading skeleton** — replaces row bodies but keeps the header visible (so the user sees the columns they're waiting on). Skeleton row count = `pageSize`.

### `<FilterBar>`, `<FilterChip>`, `<FilterMenu>`

Lives in `packages/shared-ui/src/components/filter-bar.tsx`. Composable; the page wires them.

**Layout (admin table):**

```
┌────────────────────────────────────────────────────────────────────┐
│ [🔍 search…]  [chip: Statut: actif ×]  [chip: Plan: Pro ×]  [+ Filter] │
│                                          [Vues ▾] [⋮ density] [Export] │
└────────────────────────────────────────────────────────────────────┘
```

**Rules:**

1. **Chips** — every active filter renders as a chip with a close (`×`) button. Chip label format: `<Label>: <Value>`. Multi-value: `Plan: Pro, Enterprise`.
2. **"Add filter" menu** — disclosure button opens a popover listing the page's available filters. Selecting a filter opens its specific picker (date range, multi-select, text input, etc.).
3. **"Tout effacer"** — appears at the right of the chip row when `activeFilterCount ≥ 2`. Calls `reset()`.
4. **Active filter count** — emitted from `useTableState` as `activeFilterCount`. Drives the mobile "Filtres (3)" CTA badge.
5. **Compose, don't extend** — pages add new filter types by composing existing primitives (`<DateRangeFilter>`, `<MultiSelectFilter>`, `<TextFilter>`). Never copy-paste a `<FilterMenu>` shell.

### `normalizeFr(s: string): string` — the only string comparator

Lives in `packages/shared-types/src/utils/normalize.ts`. Used **identically** on the client (filtering, autocomplete dedupe) and on the server (writing `searchKeywords[]`, comparing to `q`).

```ts
export function normalizeFr(input: string): string {
  return input
    .normalize("NFD")                       // decompose: "Sénégal" → "Sénégal"
    .replace(/[̀-ͯ]/g, "")        // strip diacritics
    .toLowerCase()
    .replace(/[''']/g, "'")                 // unify apostrophes
    .replace(/\s+/g, " ")                   // collapse whitespace
    .trim();
}
```

**Test fixtures (mandatory):** `Sénégal → senegal`, `CAFÉ-Bar  → cafe-bar`, `L'Atelier → l'atelier`, `Thiès → thies`. Tests live in `__tests__/normalize.test.ts` next to the helper.

### `<FiltersBottomSheet>` — mobile filter pattern

Lives in `packages/shared-ui/src/components/filters-bottom-sheet.tsx`. Composed from `<BottomSheet>` (sibling primitive at `bottom-sheet.tsx`), which in turn wraps the native HTML `<dialog>` element. `showModal()` provides the focus trap, ESC dismissal, and `::backdrop` pseudo-element with no third-party dependency.

**Structure:**

```
┌─────────────────────────────────┐
│ ⊟  Filtres                  ✕   │  ← sticky header
├─────────────────────────────────┤
│ [Filter group: Date]            │
│ [Filter group: Catégorie]       │  ← scrollable body
│ [Filter group: Format]          │
│ ...                             │
├─────────────────────────────────┤
│ Tout effacer    Voir 14 résultats│  ← sticky footer with live count
└─────────────────────────────────┘
```

**Rules:**

1. **Live count** — the "Voir N résultats" CTA reflects the result count for the **pending** filter state, computed via the same query the page uses. While loading, label is "Voir …".
2. **Apply on close** — changes are not committed to the URL until the user taps "Voir N résultats" or dismisses the sheet via the close button. Drag-down dismiss applies pending changes (mirrors iOS conventions).
3. **Focus trap** — native `<dialog>.showModal()` provides this. The first focusable element is the close button; tab cycles within the sheet.
4. **Triggered by** — a `<FilterTrigger>` button in the sticky search bar, labelled "Filtres" with an `activeFilterCount` badge.

### Accessibility contract — list pages

| Element                          | Required                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Search input                     | `<label>` or `aria-label`. `role="searchbox"`. `aria-controls` pointing to the result region.                      |
| Sortable column header           | `<button>` inside `<th>`. `aria-sort="none | ascending | descending"` on the `<th>`.                                |
| Filter chip (active)             | `<button aria-label="Retirer le filtre <name>">`. Pressing `Backspace` or `Delete` on chip removes it.             |
| Result region                    | `aria-live="polite"`. Count announcement: "14 événements trouvés".                                                 |
| Pagination                       | `<nav aria-label="Pagination">`. Current page: `aria-current="page"`. Disabled buttons: `aria-disabled="true"`.    |
| Bottom sheet                     | Native `<dialog>` via `<BottomSheet>` (handles `role`, `aria-modal`, focus trap, backdrop automatically).         |
| Empty state                      | `role="status"` for "no match"; nothing extra for "no data".                                                       |
| Bulk action bar                  | `role="region" aria-label="Actions groupées sur N éléments"`.                                                      |

---

## Backend primitives

### Response shape — list endpoints

Two shapes, picked by archetype.

**Page-numbered (admin tables, bounded sets):**

```ts
{
  success: true,
  data: T[],
  meta: { page: number; limit: number; total: number; totalPages: number; warnings?: string[] }
}
```

**Cursor-based (streams, large discovery sets):**

```ts
{
  success: true,
  data: T[],
  meta: { limit: number; nextCursor: string | null; hasMore: boolean; warnings?: string[] }
}
```

`warnings[]` is the canonical channel for partial-result situations (e.g. `tags` array silently sliced — see C7). Clients that ignore warnings stay backwards-compatible.

### `PaginationSchema` evolution

In `packages/shared-types/src/api.types.ts`. Two schemas, picked by route:

```ts
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.string().optional(),     // route validates against its own whitelist
  orderDir: z.enum(["asc", "desc"]).default("desc"),
});

export const CursorQuerySchema = z.object({
  cursor: z.string().optional(),       // opaque base64
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

**Per-route `orderBy` whitelist** is mandatory. Example for `/v1/events`: `orderBy: z.enum(["startDate", "createdAt", "title"]).default("startDate")`. Anything outside the whitelist → 400.

### `searchKeywords[]` — the dénormalised search field

The single mechanism for full-text-style queries on Firestore. Applied to: `events`, `organizations`, `users`, `venues`, `speakers`. **Not** applied to: feed posts, audit logs, notifications (use cursor + dedicated indexes for those).

**Write side** — every service `create`/`update` that touches an indexable field calls a shared helper:

```ts
// apps/api/src/services/_shared/search-keywords.ts
export function buildSearchKeywords(parts: { weight: 1 | 2 | 3; text: string | undefined }[]): string[] {
  const tokens = new Set<string>();
  for (const { text } of parts) {
    if (!text) continue;
    const normalised = normalizeFr(text);
    for (const word of normalised.split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < 2) continue;
      // Index every prefix of length 2..min(15, word.length)
      for (let len = 2; len <= Math.min(15, word.length); len++) {
        tokens.add(word.slice(0, len));
        if (tokens.size >= 200) return [...tokens];   // hard cap
      }
    }
  }
  return [...tokens];
}
```

Per-resource composition (locked):

| Resource       | Source fields                                                                          |
| -------------- | -------------------------------------------------------------------------------------- |
| `events`       | `title` (×3 weight, future), `tags[]`, `location.city`, `location.country`             |
| `organizations`| `name`, `slug`, `city`, `country`                                                      |
| `users`        | `displayName`, `email` local-part                                                      |
| `venues`       | `name`, `address.city`, `address.country`                                              |
| `speakers`     | `name`, `headline`                                                                     |

**Read side** — services translate `q` to:

```ts
if (q) {
  const needle = normalizeFr(q).split(/\s+/).filter((t) => t.length >= 2)[0]; // first significant token
  if (needle) query = query.where("searchKeywords", "array-contains", needle);
}
```

We deliberately use **one** `array-contains` (the most selective token), not `array-contains-any` with multiple tokens — the latter can't be combined with other equality filters on Firestore. Multi-token search refines client-side **within the page** only (acceptable: page is already bounded).

**Migration** — adding `searchKeywords[]` to an existing collection requires a backfill. Pattern: a one-shot `npm run backfill:search-keywords -- --collection=events` script that reads in batches of 500, writes via batched updates, idempotent.

### Soft-delete by default

`BaseRepository.findMany()` excludes documents with `status ∈ {"archived", "cancelled", "deleted"}` by default. Opt-in via `{ includeArchived: true }` for admin endpoints that explicitly need them. Each route declares its choice — no implicit defaults at the route layer.

Audit obligation: every existing `findMany` call in `apps/api/src/repositories/` and `apps/api/src/services/` is reviewed against this rule when a route is migrated. The migration playbook (Step 3) tracks coverage.

### Cursor pagination — when and how

Use cursor pagination on:
- Streams (feed, messages).
- Audit logs (already large; will overflow page-counting).
- Discovery results > 1 000 expected matches.

The cursor is **opaque** to the client. Server constructs it as `base64(JSON.stringify({ orderByValue, docId }))` and validates it against the current `orderBy` field — a cursor minted under `orderBy=startDate` is rejected if the next request uses `orderBy=createdAt` (consistency over flexibility).

---

## Data conventions — Firestore

### Index hygiene

1. **One composite per (collection, primary filter combo)**. Wide composites (>6 fields) are a smell — the audit found one with 10 fields on `events`. Refactor by splitting the user-facing surface into two narrower endpoints rather than chasing every combination.
2. **Document each index in code** — every composite in `infrastructure/firebase/firestore.indexes.json` has a sibling comment in the consuming repository (`// index: events (organizationId asc, status asc, startDate asc)`). The two stay in sync via review, not automation (yet).
3. **Audit script** — `npm run firestore:audit-indexes` (Step 3 deliverable) reports indexes with zero recent reads and indexes referenced by no repository.

### Denormalisation rules

| Need                                  | Denormalisation                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Filter events by city without `nested` index limits | `city: string` and `country: string` at the document root, mirrored from `location`. |
| Sort events by popularity             | `popularityScore: number` at the root, refreshed by `event.registration.created/cancelled` listener. |
| Display registration → event title without N+1 | `eventTitle: string` denormalised on `registrations` (already partially done).        |
| Discovery search                      | `searchKeywords: string[]` per § Backend primitives.                                  |

Every new denormalised field MUST be maintained by a Cloud Functions trigger (or by the writing service in the same transaction). A denormalised field with no maintenance path is a bug, not a feature.

### Precomputed counters

For sort-by-popularity and capacity bars:

| Counter            | On                                  | Maintained by                                                  |
| ------------------ | ----------------------------------- | -------------------------------------------------------------- |
| `registeredCount`  | `events`                            | `registration.created` / `cancelled` listener (existing).      |
| `popularityScore`  | `events`                            | New listener: `0.6 × registeredCount + 0.3 × bookmarkCount + 0.1 × feedPostCount`, recomputed on those events. |
| `feedPostCount`    | `events`                            | `feed.post.created` listener.                                  |
| `bookmarkCount`    | `sessions`                          | `session.bookmarked` listener.                                 |
| `memberCount`      | `organizations`                     | `member.added` / `removed` listener (existing).                |

Counter drift is acceptable on the order of seconds (eventual consistency), not minutes. Add a `recomputeCounters` cron (weekly) that walks each collection and corrects drift, logged to `auditLogs` if non-zero.

---

# Step 3 — Application

This section turns the doctrine into something a senior engineer can apply without re-deriving anything. It contains: copy-pasteable archetype skeletons, the saved-views feature design, the page-by-page migration playbook, the roadmap with acceptance criteria, and the journal of decisions deliberately deferred.

## Archetype skeletons

Each skeleton is the canonical wiring for a new page in its archetype. Names and imports refer to primitives defined in Step 2. Copy, adapt to the resource, never invent a different shape.

### Skeleton A — Admin table

```tsx
// apps/web-backoffice/src/app/(admin)/admin/users/page.tsx
"use client";

import { parseAsString, parseAsStringEnum } from "nuqs";
import { useTableState } from "@/hooks/use-table-state";
import { useAdminUsers } from "@/hooks/use-admin-users";
import { DataTable } from "@teranga/shared-ui";
import { FilterBar, FilterChip, FilterMenu } from "@teranga/shared-ui";
import { SavedViewsMenu } from "@/components/admin/saved-views-menu";

const SORTABLE_FIELDS = ["createdAt", "displayName", "email"] as const;

type Filters = { role?: "organizer" | "participant" | "super_admin" | "venue_manager"; status?: "active" | "suspended" };

export default function AdminUsersPage() {
  const t = useTableState<Filters>({
    urlNamespace: "users",
    defaults: { sort: { field: "createdAt", dir: "desc" }, pageSize: 25 },
    sortableFields: SORTABLE_FIELDS,
    filterParsers: {
      role: parseAsStringEnum(["organizer", "participant", "super_admin", "venue_manager"]),
      status: parseAsStringEnum(["active", "suspended"]),
    },
  });

  const { data, isLoading, isError, refetch } = useAdminUsers({
    q: t.debouncedQ,
    role: t.filters.role,
    isActive: t.filters.status === "active" ? true : t.filters.status === "suspended" ? false : undefined,
    page: t.page,
    limit: t.pageSize,
    orderBy: t.sort?.field,
    orderDir: t.sort?.dir,
  });

  return (
    <PageShell>
      <FilterBar
        searchValue={t.q}
        searchPlaceholder="Rechercher par nom ou email…"
        onSearchChange={t.setQ}
        activeChips={renderChips(t)}
        onClearAll={t.activeFilterCount >= 2 ? t.reset : undefined}
        addFilterMenu={<FilterMenu /* … */ />}
        savedViews={<SavedViewsMenu pageKey="admin.users" state={t} />}
      />
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        sort={t.sort}
        onToggleSort={t.toggleSort}
        responsiveCards
        ariaLabel="Liste des utilisateurs"
        emptyMessage={t.activeFilterCount > 0 ? "Aucun résultat" : "Aucun utilisateur"}
        emptyAction={t.activeFilterCount > 0 ? { label: "Effacer les filtres", onClick: t.reset } : undefined}
      />
      <Pagination page={t.page} pageSize={t.pageSize} total={data?.meta.total ?? 0} onPageChange={t.setPage} onPageSizeChange={t.setPageSize} />
    </PageShell>
  );
}
```

**What this does that the current `/admin/users` does not:** URL state, debounced search, sortable columns, saved views slot, page-size selector, "clear all" CTA, sticky header (via DataTable v2), accent-folded server-side search via `searchKeywords[]`.

### Skeleton B — Marketplace discovery (participant)

```tsx
// apps/web-participant/src/app/(public)/events/page.tsx
"use client";

import { useTableState } from "@/hooks/use-table-state";
import { useEventSearch } from "@/hooks/use-event-search";
import { EventFilterBar } from "@/components/event-filter-bar";
import { FiltersBottomSheet } from "@teranga/shared-ui";
import { EditorialEventCard } from "@teranga/shared-ui";

const SORT_OPTIONS = ["relevance", "date", "popularity", "price_asc", "price_desc"] as const;

type Filters = {
  category?: EventCategory[];     // multi
  format?: EventFormat;
  city?: string;
  date?: "today" | "this_week" | "this_weekend" | "this_month";
  price?: "free" | "paid";        // wired to backend, see P0.1
  organizationId?: string;
};

export default function EventsDiscoveryPage() {
  const t = useTableState<Filters>({
    urlNamespace: "",   // root URL, no prefix
    defaults: { sort: { field: "relevance", dir: "desc" }, pageSize: 12 },
    sortableFields: SORT_OPTIONS,
    filterParsers: { /* … */ },
  });

  const { data, isLoading } = useEventSearch({ q: t.debouncedQ, ...t.filters, ...mapDateChip(t.filters.date), sort: t.sort, page: t.page, limit: t.pageSize });

  return (
    <DiscoveryShell>
      <StickySearchBar value={t.q} onChange={t.setQ} onOpenFilters={() => setBottomSheetOpen(true)} activeFilterCount={t.activeFilterCount} />
      <ActiveChipsRow chips={renderChips(t)} onClearAll={t.activeFilterCount > 0 ? t.reset : undefined} />
      <SortMenu value={t.sort} onChange={t.toggleSort} options={SORT_OPTIONS} />
      <ResultCount value={data?.meta.total ?? 0} loading={isLoading} />  {/* aria-live */}
      <EventGrid items={data?.data ?? []} loading={isLoading} emptyState={<DiscoveryEmptyState filters={t.filters} onClear={t.reset} />} />
      <Pagination page={t.page} pageSize={t.pageSize} total={data?.meta.total ?? 0} onPageChange={t.setPage} />
      <FiltersBottomSheet open={bottomSheetOpen} onClose={() => setBottomSheetOpen(false)} state={t} liveCount={data?.meta.total} />
    </DiscoveryShell>
  );
}
```

**Critical differences from current `/events`:** multi-select category, user-choosable sort, `price` actually wired (P0.1), bottom-sheet on mobile, accent-folded search via backend `searchKeywords[]`, autocomplete (separate component, attached to `StickySearchBar`).

### Skeleton C — Stream / inbox

```tsx
// apps/web-participant/src/app/(authenticated)/notifications/page.tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { parseAsBoolean } from "nuqs";
import { useTableState } from "@/hooks/use-table-state";

export default function NotificationsPage() {
  const t = useTableState<{ unreadOnly?: boolean }>({
    urlNamespace: "notifications",
    defaults: { pageSize: 20 },
    sortableFields: [],   // streams: sort is forced
    filterParsers: { unreadOnly: parseAsBoolean },
  });

  const query = useInfiniteQuery({
    queryKey: ["notifications", t.filters.unreadOnly],
    queryFn: ({ pageParam }) => notificationsApi.list({ cursor: pageParam, limit: t.pageSize, unreadOnly: t.filters.unreadOnly }),
    getNextPageParam: (last) => last.meta.nextCursor,
    initialPageParam: undefined as string | undefined,
  });

  return (
    <StreamShell>
      <FilterToggle label="Non lues uniquement" value={t.filters.unreadOnly ?? false} onChange={(v) => t.setFilter("unreadOnly", v || undefined)} />
      <NotificationList pages={query.data?.pages ?? []} />
      <InfiniteScrollSentinel onIntersect={query.fetchNextPage} disabled={!query.hasNextPage || query.isFetchingNextPage} />
      <EndOfStreamMarker visible={!query.hasNextPage} />
    </StreamShell>
  );
}
```

**Streams never expose a sort UI.** Cursor pagination is mandatory (`getNextPageParam`). The "X new items" banner pattern (already implemented for feed) is added on top when polling is enabled.

---

## Saved views — feature design

Saved views are the recall dimension (#6) made operational. Gated to **Pro / Enterprise organisers** (member-level, per-user) and to **super-admins** (always available).

### Schema — `savedViews` collection

```ts
type SavedView = {
  id: string;
  ownerId: string;                          // user uid
  scope: "organization" | "platform";       // platform = super-admin only
  organizationId: string | null;            // null for platform scope
  pageKey: string;                          // "admin.users", "admin.organizations", "events", "registrations"…
  name: string;                             // "Comptes suspendus à relancer"
  emoji?: string;                           // "🔴" — optional
  state: {
    q?: string;
    filters: Record<string, unknown>;
    sort: SortState;
    pageSize: 10 | 25 | 50 | 100;
    columns?: string[];                     // future: custom column visibility
    density?: "compact" | "comfortable";
  };
  isDefault: boolean;                       // one per (ownerId, pageKey) max
  createdAt: string;
  updatedAt: string;
};
```

Stored at `savedViews/{viewId}`. Indexed: `(ownerId, pageKey, updatedAt desc)` and `(organizationId, pageKey, isDefault asc)`.

### Permissions

| Action                              | Permission                                                     |
| ----------------------------------- | -------------------------------------------------------------- |
| Read own views                      | `view:read_own` (new, granted to all authenticated users).     |
| Create / update / delete own view   | `view:manage_own`.                                             |
| Mark a view as the org's default    | `organization:manage` + Pro/Enterprise plan.                   |
| Manage platform-scoped views        | `platform:manage`.                                             |

### UI — `<SavedViewsMenu>`

A dropdown anchored to the toolbar. States:

- **No views** — single CTA "Enregistrer la vue actuelle". Plan-gated: free/starter shows the upsell tooltip from [`error-handling.md`](./error-handling.md) PlanGate.
- **≥1 view** — list of named views with the active one highlighted; each row has the name, last-updated relative time, and a `⋮` for rename/delete/set-default.
- **Footer** — "Enregistrer la vue actuelle…" if the current state ≠ any saved view, plus "Gérer les vues" link.

### Behaviour

1. **Loading a view** — replaces the entire URL state in one history entry. The URL is then shareable as a regular shareable URL (saved views are a personal layer over URL state, not a replacement).
2. **Drift indicator** — when the current URL state diverges from the loaded view, the menu shows "Vue modifiée" and a "Mettre à jour" CTA.
3. **Default view** — applied on page load when no URL params are present. URL params always win.
4. **Org-shared views (Phase 3)** — Pro/Enterprise gets `<SharedViewsTab>` for views shared org-wide, with the same schema but `ownerId = null` and `organizationId` set.

### Plan gating

Per [`error-handling.md`](./error-handling.md) and the freemium contract in `CLAUDE.md`:

| Plan       | Saved views                                                                |
| ---------- | -------------------------------------------------------------------------- |
| Free       | Hidden behind `<PlanGate fallback="hidden">` — feature does not exist.     |
| Starter    | Same — feature does not exist.                                             |
| Pro        | Up to 10 personal views per page, per user.                                |
| Enterprise | Unlimited personal views + org-shared views (Phase 3).                     |
| Super-admin| Always — separate `scope: "platform"`, no plan check.                      |

Server-side enforcement lives in `apps/api/src/services/saved-view.service.ts` via `BaseService.requirePlanFeature("savedViews")`. The new feature flag adds to `PlanFeatures` in `packages/shared-types/src/organization.types.ts`.

---

## Migration playbook

Existing pages migrate to the doctrine in waves, ordered by user-visible impact and refactor risk. The rule: **a page either fully complies or it does not**. Half-migrated pages create the divergence we are trying to delete.

For each page, the migration is a single PR that ticks every applicable box. The reviewer (security-reviewer + test-coverage-reviewer agents) blocks the merge until the boxes are ticked.

### Migration checklist (per page)

- [ ] `useTableState` replaces all ad-hoc `useState` for `q`, filters, sort, page, pageSize.
- [ ] URL params namespaced and persisted via `nuqs`.
- [ ] Search debounced 300 ms; sent as `q` to the server.
- [ ] Server uses `searchKeywords[]` for `q` (not `where("title", "==")` or post-fetch `.includes`).
- [ ] Sortable columns expose `sortable: true` + `sortField`. `aria-sort` reflects state.
- [ ] Active filters render as removable chips. "Tout effacer" appears at ≥ 2 active filters.
- [ ] Empty state distinguishes "no data" from "no match" with the right CTA.
- [ ] Page-size selector (10/25/50/100) wired and persisted to localStorage.
- [ ] Sticky header + sticky action column where applicable.
- [ ] Mobile: filters in `<FiltersBottomSheet>` with live count.
- [ ] A11y pass: `aria-sort`, `aria-live`, focus rings, keyboard nav (j/k/Enter/Esc/?).
- [ ] CSV export (where it exists) reflects current filters.
- [ ] Saved views slot present (`<SavedViewsMenu pageKey="…">`), even if the feature is plan-gated off for the current user.
- [ ] Unit tests + route tests refreshed per `.claude/skills/teranga-testing/SKILL.md`.

### Page-by-page wave plan

Status legend: ✅ shipped, 🟡 partial / blocked, ⏳ in-flight, ⬜ not started.

| Wave   | Page                                              | Status | Why this order                                                                          |
| ------ | ------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| **W1** | `/events` participant (discovery)                 | ✅     | The visible-bug surface. C1, C2, C3 all live here.                                      |
| **W1** | `/admin/users`                                    | ✅     | Highest internal-user pain. C6, C8 live here. Reference admin migration.                |
| **W1** | `/admin/organizations`                            | ✅     | Sister page to `/admin/users`. Establish the admin pattern in 2 PRs.                    |
| **W2** | `/events` backoffice                              | ✅     | Highest organiser pain. Bring searchKeywords + sort + URL state.                        |
| **W2** | `/events/[id]/audience/registrations`             | ✅     | Per-event flow; high frequency. Add participant search.                                 |
| **W2** | `/admin/audit`                                    | ✅     | Already the reference; light refactor to adopt `useTableState` + DataTable v2.          |
| **W3** | `/admin/coupons`, `/admin/plans`, `/admin/jobs`   | ✅     | Lower frequency; bundled.                                                               |
| **W3** | `/admin/invites`, `/admin/subscriptions`, `/admin/webhooks`, `/admin/api-keys` | ✅ | Same.                                                                                   |
| **W3** | `/admin/venues`, `/admin/notifications`           | ✅     | Same.                                                                                   |
| **W4** | `/venues` organiser                               | ✅     | PR #213. Bare card grid → search + status/type filter + 5-option sort + page-numbered.  |
| **W4** | `/badges`                                         | ✅     | PR #216. New `BadgeTemplateQuerySchema` + accent-folded q + isDefault filter + 11 indexes. |
| **W4** | `/communications` (Library tab)                   | ✅     | PR #218. Search + URL state + accent-folded filter on the Bibliothèque tab. Composer/Timeline tabs intentionally untouched (not list archetype). |
| **W4** | `/participants` Annuaire                          | 🟡     | Stub preserved; backend cross-event participant index lands in O10. Page renders the doctrine chrome (`<SavedViewsMenu>` + `<BulkActionToolbar>`) for review continuity but the directory itself is a CTA-to-events placeholder. |
| **W5** | `/my-events`, `/notifications` participant        | ✅     | PR #211. Stream-archetype migration; cursor pagination introduced.                      |
| **W5** | `/messages`, `/feed`                              | ⬜     | Search post-MVP. Stream archetype already correct (chronological, no sort UI).          |

#### Auditor + index hardening shipped alongside the W4 wave

The static composite-index auditor at `scripts/audit-firestore-indexes.ts`
gained four capabilities while shipping the W4 migrations, all derived
from real production-class regressions:

| Capability                                          | Lands in | Catches the next…                                                                |
| --------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| Zod-enum expansion of `?? "literal"` orderBy        | PR #214  | Page that ships a sort menu without the matching composite (the `/events` "Ordre alphabétique" 0-results bug). |
| `private`/`protected` access modifiers in extractor | PR #214  | Repository methods hidden behind a private dispatcher (`searchByKeyword`, `searchByTagsOrFilters`).             |
| Single-statement-`if` conditional detection         | PR #214  | Repos that build their where-clauses with `if (filters.x) wheres.push(…)` (no braces) — every clause was treated as MANDATORY before. |
| Direction expansion + `z.literal` enum + smallest-match heuristic | PR #215 + #217 | Routes whose Zod schema declares both `asc` and `desc` orderDir but the repo literal only covers one direction (the `/v1/events/org/:orgId` 500). |
| Route-layer scan for bare `validate({ query: PaginationSchema })` | PR #217 | Future routes that inherit the open-string `orderBy` from `PaginationSchema` instead of declaring a closed enum. |

Status: auditor exits 0 with **all primary (maximal + mandatory-only)
query shapes covered** across the entire codebase. Subset warnings (~840)
are gated behind `AUDIT_SUBSETS=1` and surface in the strict pre-deploy
audit on `deploy-staging.yml`.

The waves are work units, not strict timelines — W1 is the first thing built; W2 starts after W1 lands.

---

## Roadmap — P0 → P3

### P0 — Critical bugfixes (no doctrine dependency)

These fix user-visible breaks and close audit findings without waiting for the new primitives. Each is its own PR.

| #     | Task                                                                                       | Acceptance criteria                                                                                   |
| ----- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| P0.1  | Wire `price` filter end-to-end on `/events` participant.                                   | Schema accepts `price: "free" | "paid"`. Service filters tickets correctly. Tests cover both cases. UI chip toggles change result count. |
| P0.2  | Add `searchKeywords[]` to `events` + write listener + backfill script.                     | New events get the field. Backfill processes existing events idempotently. `q` query uses `array-contains`. Pagination is honest. |
| P0.3  | Debounce 300 ms on `/events` backoffice and `/admin/users` and `/admin/organizations`.     | Typing 5 chars fires ≤ 2 requests (initial + debounced). Tested via `vi.useFakeTimers()`.            |
| P0.4  | Enforce soft-delete default in `BaseRepository.findMany`.                                  | Default excludes archived. `includeArchived: true` opt-in. Audit of all callers documented.          |
| P0.5  | Warn on `tags > 30` truncation in event search.                                            | Response carries `meta.warnings: ["TAGS_TRUNCATED:30"]`. Frontend renders an inline notice.          |
| P0.6  | Batch `auth.getUsers([uids])` on `/admin/users` listing.                                   | One Auth call per page (not per row). Load time on 100-row page ≤ 1× single-doc latency.             |
| P0.7  | Add pagination to `/admin/coupons`.                                                        | Hardcoded `limit = 20`. Page-numbered. Tests assert correct slicing.                                 |

P0 lands on this branch, in the order above. P0.2 unlocks the rest of the doctrine — without it, "search works" remains a lie.

### P1 — Doctrine primitives + first migrations

| #     | Task                                                                                       | Owner artefact                                                                                        |
| ----- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| P1.1  | Install `nuqs` in both Next.js apps.                                                       | `package.json`, `app.tsx` provider wiring.                                                            |
| P1.2  | Implement `useTableState` hook (admin + participant mirrors).                              | `apps/web-backoffice/src/hooks/use-table-state.ts`, `apps/web-participant/src/hooks/use-table-state.ts`. |
| P1.3  | Upgrade `<DataTable>` to v2: sortable headers, `aria-sort`, sticky header, density.        | `packages/shared-ui/src/components/data-table.tsx`. Stories + a11y tests refreshed.                   |
| P1.4  | Build `<FilterBar>`, `<FilterChip>`, `<FilterMenu>`, `<DateRangeFilter>`, `<MultiSelectFilter>`. | `packages/shared-ui/src/components/filter-bar.tsx` and friends. Stories + tests.                      |
| P1.5  | Build `<BottomSheet>` + `<FiltersBottomSheet>` (mobile).                                  | `packages/shared-ui/src/components/bottom-sheet.tsx` + `filters-bottom-sheet.tsx`. Native `<dialog>` backed. |
| P1.6  | `normalizeFr` helper + tests.                                                              | `packages/shared-types/src/utils/normalize.ts`. Test fixtures from § Frontend primitives.             |
| P1.7  | Migrate Wave 1 pages (3 PRs): `/events` participant, `/admin/users`, `/admin/organizations`. | Migration checklist ticks. PR template links to this doc.                                             |

### P2 — Coverage waves

P2.x = each Wave 2/3/4/5 PR from the migration playbook. No new primitives expected; if a primitive is missing, raise it as a Step 2 amendment.

### P3 — Deferred / opt-in

| #     | Feature                                                                          | Status                                                                                                |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| P3.1  | Typesense / Algolia migration for participant discovery.                         | Deferred. `searchKeywords[]` covers the bar today. Re-evaluate at 50 k events or when fuzzy is asked. |
| P3.2  | Geolocation "près de moi" + radius (Geohash on events).                          | Deferred to post-Wave-9. Requires venue coordinates as a precondition.                                |
| P3.3  | Map view on `/events` (MapLibre).                                                | Deferred. Depends on P3.2.                                                                            |
| P3.4  | Multi-column sort (Shift+click).                                                 | Deferred. Adopt TanStack Table when this is needed.                                                   |
| P3.5  | Column visibility selector.                                                      | Deferred. Same trigger as P3.4.                                                                       |
| P3.6  | Query language (`status:active plan:pro`) on admin pages.                        | Deferred. Power-user feature; revisit after saved views land.                                         |
| P3.7  | Org-shared saved views.                                                          | Deferred. Personal saved views ship first; sharing is a Pro/Enterprise upsell.                        |
| P3.8  | Saved-search alerts (notification when a new event matches).                     | Deferred. Requires notification channel; tied to Wave 7.                                              |
| P3.9  | Faceted result counts (Polaris-style "Catégorie: Conférence (12)").              | Deferred. Requires aggregation pipeline; revisit if `searchKeywords[]` saturates.                     |

---

## Decisions journal

Decisions made by this doctrine, with the why. New decisions append; existing ones never silently change.

| Date       | Decision                                                                                       | Rationale                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-26 | Adopt `nuqs` for URL state, not a custom hook.                                                 | Mature, type-safe, ~1 k★, MIT, Next-native. Building our own in 2026 is reinvention.                                                |
| 2026-04-26 | Keep `<DataTable>` in-house; defer TanStack Table.                                             | Current implementation is light, responsive, owns its mobile cards. TanStack adds bundle weight without unlocking anything we ship today. Triggers for adoption: multi-column sort, draggable columns, 1 000+ row virtualisation. |
| 2026-04-26 | Firestore `searchKeywords[]` + `array-contains`, not Typesense.                                | Solves C2/C3/no-prefix without external dependency. We re-evaluate at 50 k events or when fuzzy/typo-tolerance is requested.       |
| 2026-04-26 | Saved views gated to Pro/Enterprise organisers + super-admins.                                 | Personal-productivity feature; aligns with the freemium contract; super-admins always get them as platform tooling.                |
| 2026-04-26 | Bottom sheet via Radix `Dialog` with `bottom-sheet` variant, not a third-party library.        | Radix is already in the bundle; the variant is a CSS animation; consistent with the rest of the design system.                     |
| 2026-04-27 | **Amended**: bottom sheet is backed by the native HTML `<dialog>` element, not Radix.           | Audit during P1.10 implementation found Radix is NOT a shared-ui dependency — only `lucide-react`, `clsx`, `class-variance-authority`, `sonner`, `tailwind-merge`. The existing `<Dialog>` primitive already uses native `<dialog>` + `showModal()` for focus trap / ESC / backdrop. Same pattern reused in `<BottomSheet>` keeps shared-ui dep-light and consistent. The doctrine's UX contract (slide-up on mobile, centered modal on `md:`+, sticky header / footer, focus trap, ESC dismissal) is honoured identically — only the implementation detail changed. |
| 2026-04-26 | Three archetypes (admin / discovery / stream) — each with distinct toolbar, sort, pagination.  | A single "table doctrine" was the shortcut that produced the audit. Distinct rules per archetype are the only way to stop drift.   |
| 2026-04-26 | Streams expose **no** user-chosen sort.                                                        | Chronological order is the contract of a stream; offering sort breaks the "read upstream then read downstream" mental model.       |
| 2026-04-26 | Page-numbered for admin tables; cursor for streams; cursor for discovery > 1 000 expected matches. | Page numbers are a UX affordance ("X sur Y"); cursors are honest at scale. Pick by archetype, not by gut.                          |
| 2026-04-26 | `meta.warnings[]` is the canonical channel for partial-result situations.                      | Silent truncation produces audit findings forever. Warnings are opt-in for clients but always emitted by the server.               |
| 2026-04-26 | `pageSize` reads URL → localStorage → default. Setting `pageSize` writes both URL and localStorage. | Combines shareable URLs with sticky personal defaults. Either alone fails one of the two use cases.                                |

---

## Bookmark

This document is canonical. Disagreements are filed as PRs against the document **before** any code change that contradicts it. If you find yourself thinking "I'll just deviate this once" — stop, and either get the document amended or align the code.

The reference internal page that already nails most of this is `/admin/audit`. The reference external benchmarks are Stripe Dashboard tables, Linear's issue list, and Airbnb's stays search. When in doubt, read either of those, then come back.


