# Component Patterns

> **Editorial v2 (2026-04-17)** — after the Teranga Participant handoff, buttons default to **pill-shaped** (`rounded-full`) and the dark primary is navy on light / gold on dark. The backoffice still uses `rounded-lg` for dense table-adjacent actions; the participant app uses `rounded-full` throughout.

Reusable UI patterns used across both web applications. Editorial primitives live in `apps/web-participant/src/components/` today; promoting them to `packages/shared-ui/` is the next phase so the backoffice can reuse them directly.

---

## Buttons

### Variants

| Variant | Appearance | Usage |
|---------|-----------|-------|
| **Primary (light)** | Navy background, white text, pill | Main actions in the participant app |
| **Primary (dark)** | Gold background, navy text, pill | Same actions on `.dark` theme |
| **Outline** | Transparent, 1px border, pill | Secondary actions: "Détails", "Partager" |
| **Ghost** | Transparent, muted text, pill | Tertiary actions, icon-only, back links |
| **Gold** | Gold background, navy text, pill | Marketing CTAs, hero search submit, homepage "Voir tous les événements" |
| **Destructive ghost** | `text-destructive` + `hover:bg-destructive/10` | Cancel registration, cancel event |

### Sizes

| Size | Height | Padding | Font Size | Touch Target |
|------|--------|---------|-----------|-------------|
| `sm` | 32px | `px-3 py-1.5` | 13px | 32px min |
| `md` | 40px | `px-5 py-2.5` | 14px | 44px (with spacing) |
| `lg` | 48px | `px-7 py-3` | 15px | 48px |
| `cta` | 52px | `px-8 py-3.5` | 15px | 52px — use for hero + success actions |

### States

- **Default**: Solid background.
- **Hover**: Navy → `teranga-navy-2`; gold → `teranga-gold-light`; outline → `bg-muted`.
- **Focus**: 2px `teranga-gold` outline with 2px offset (global `:focus-visible` rule).
- **Disabled**: `pointer-events-none` (not `cursor-not-allowed`) + muted background + `text-muted-foreground`.
- **Loading**: Spinner replaces leading icon; label stays.

### Canonical primary (participant)

```tsx
<Link
  href="/events"
  className="inline-flex items-center gap-2 rounded-full bg-teranga-navy px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
>
  Voir tous les événements
  <ArrowRight className="h-4 w-4" aria-hidden="true" />
</Link>
```

---

## Cards & Editorial Tiles

### Editorial Event Card (Participant)

Canonical card for event grids. Implemented in `components/editorial-event-card.tsx`.

```
+-------------------------------------+
|  [Cover 16:10 — gradient or image]  |
|  CONFÉRENCE            TER · 001/003|
+-------------------------------------+
| 14 MAI 2026            Dakar        |
| Dakar Tech Summit 2026 (Fraunces 22)|
| Trois jours pour repenser l'éco…    |
|                                     |
| 15 000 FCFA              (→) pill  |
| 847 inscrits · 71% rempli           |
+-------------------------------------+
```

- **Radius**: `rounded-card` (14px).
- **Cover**: `aspect-[16/10]`. Uses `coverImageURL` if set; otherwise `getCoverGradient(event.id).bg` (8-palette rotation) + `.teranga-cover` grain/stripe texture.
- **Scarcity pill**: when `registeredCount / maxAttendees ≥ 85%`, replace the category kicker with a clay "Plus que N places" pill.
- **Index chip** (top-right): mono 10px `TER · 001/008`. From `{ index, total }` props.
- **Hover**: `-translate-y-0.5` + shadow (`0_22px_50px_-30px_rgba(15,15,28,0.25)`). Cover image scales 1.03.

### Featured Tile (Home `isFeatured` events)

- Split grid `md:grid-cols-[1.1fr_1fr]`.
- Left: cover ≥380px tall; mono category kicker + index chip; title on top of a `bg-gradient-to-b to-black/45` overlay for legibility.
- Right: tag chips + teaser copy + 2×2 meta grid (Dates / Lieu / Tarif / Affluence with a live `.teranga-pulse-dot`) + two pill CTAs ("S'inscrire" primary + "Détails" outline).

### Upcoming Row (My Events)

- `md:grid-cols-[220px_1fr_auto]`.
- Left: 180–220px branded gradient column with a bottom-left mono kicker (ticket-name or category).
- Middle: mono date kicker + status pill + Fraunces 22px title + inline meta row.
- Right: action stack of pill buttons (Badge primary / Détails outline / Annuler or Remboursement ghost-destructive).

### Past Event Card (My Events)

`h-[140px]` cover + body for `status: "checked_in"`. Navy "✓ Enregistré" overlay pill, Fraunces title, muted meta.

### Stat Card (Backoffice dashboard)

`rounded-xl` white, 40px icon circle, large numeric, green/red trend indicator. Unchanged from v1.

### Order Summary (Registration step 2)

Sticky (`lg:sticky top-24`) tile on the right column of the Paiement step.

- Radius `rounded-tile` (20px).
- Top band: 120px event cover (gradient fallback via `getCoverGradient`), `bg-gradient-to-t to-black/50` overlay, mono date kicker + Fraunces event title in white.
- Body: mono "Récapitulatif" kicker, line items (ticket name, optional discount in `teranga-green`, service fees "Inclus", 1px divider, bold total), 48h refund microcopy.

---

## Forms

### Input Fields

- **Height**: 40px (`py-2.5`)
- **Border**: 1px `border-gray-200`
- **Radius**: `rounded-lg` (8px)
- **Focus**: `ring-2 ring-[#1A1A2E]/20 border-[#1A1A2E]`
- **Error**: `border-red-500`, error message in `text-red-500 text-xs mt-1`
- **Label**: `text-sm font-medium text-gray-700 mb-1` (block, above input)

### Select

Same styling as input, with native `<select>` element and `bg-white` to ensure arrow visibility.

### Multi-step Forms (Wizard)

Canonical implementation: `/register/[eventId]` in the participant app.

```
Step 1 (Billet)     Step 2 (Paiement)    Step 3 (Confirmation)
  [1]─────────────── [2]─────────────── [3]
  active (navy ring) muted                muted
```

- **Active step**: Navy `bg-teranga-navy` circle 28×28px with white number, 3px `ring-teranga-navy/20` offset ring. Label `font-semibold text-foreground`.
- **Completed step**: `bg-teranga-green` circle with a white 3.5×3.5 `Check` icon (strokeWidth 3).
- **Upcoming step**: `bg-muted` circle with muted-foreground number.
- **Step labels**: right of each circle (`hidden sm:block`), mono `text-sm`, active bolded.
- **Connectors**: `h-px w-8 bg-border` between consecutive circles.
- **Right-hand kicker**: `font-mono-kicker text-[11px] tracking-[0.1em]` showing `"Étape N/3"`.
- **Navigation** (per step): outline "Retour" pill + primary pill ("Payer X FCFA →", "Confirmer", etc.).

### Form Layout

- **Spacing**: `space-y-4` between fields
- **Labels**: Above inputs, never floating
- **Required fields**: Red asterisk after label text
- **Help text**: `text-xs text-gray-500` below input
- **Error text**: `text-xs text-red-500 mt-1` below input, replaces help text

---

## Editorial Primitives

New primitives introduced in Editorial v2. Currently co-located with the participant app; next phase is promotion to `packages/shared-ui`.

### SectionHeader

```
— À LA UNE CETTE SAISON
Trois événements qu'on ne manquerait pour rien au monde
Sélectionnés par la rédaction Teranga…                       [right action]
```

- Mono kicker: `text-[11px]`, `tracking-[0.14em]`, uppercase, `text-teranga-gold-dark`.
- Title: `.font-serif-display`, `text-[36px]`, `leading-[1.08]`, `tracking-[-0.02em]`, semibold.
- Sub: `text-[15px] leading-relaxed text-muted-foreground`, max-w 640px.
- Right action (optional): pill chip or filter count.

### Ticket Stub (decorative)

Homepage hero's tactile pass. Rendered `aria-hidden` because every field is illustrative.

- `rounded-[18px]`, `bg-teranga-gold-whisper`, `-rotate-[4deg]`, shadow `0_40px_80px_-30px_rgba(0,0,0,0.5)`.
- Header mono kicker ("Admit One · Pass Nominatif") + Fraunces 28px event title + 3-up meta fields.
- Perforation: `border-t-2 border-dashed border-teranga-navy/15` with two `bg-teranga-navy` notches sized 20×20 at each edge.
- QR: deterministic SVG pattern (`DecorativeQR`) — not a real signed QR.

### Ticket Pass (badge + success)

Canonical ticket used in two places: the `/register/:id` success step and the `/my-events/:id/badge` page.

- `rounded-pass` (22px), `bg-teranga-navy`, `text-white`, shadow `0_40px_80px_-30px_rgba(0,0,0,0.6)`.
- Header gradient uses `linear-gradient(135deg, ${tint} 0%, #1A1A2E 120%)` where `tint` comes from `getCoverGradient(event.id).tint`.
- Dashed separator `border-b border-dashed border-white/25` with two paper-colour notches (`bg-background`) positioned `-bottom-2.5 -left-2.5 / -right-2.5`.
- Footer: QR on white `rounded-[14px]` tile + truncated mono code + optional holder + gold `ACCÈS VALIDE` pill.
- Reveal animation: `transform: translateY(16px) scale(.98) → translateY(0) scale(1)` over `600ms cubic-bezier(.2,.7,.2,1)`.

### Payment Method Card (Wave / OM / Free Money / Card)

Used in the `/register/:id` Paiement step.

- Row layout: 44px colored `rounded-[10px]` glyph tile (W / OM / F / CB) + name + description + 5×5px radio indicator.
- Selected state: `border-2 border-teranga-navy`, `bg-muted/40`, radio becomes a 6px navy ring.
- Each brand's accent color (Wave `#1DC8F1`, Orange Money `#FF7900`, Free Money `#CD0067`, Card `#635bff`) is confined to the glyph tile; labels and borders stay in the Teranga palette.

### Capacity Bar

Used on event detail sticky sidebar + order summary + my-events panels.

- Track: `h-1.5` (sidebar) or `h-2` (emphasis), `bg-muted`, `rounded-full`.
- Fill: `bg-gradient-to-r from-teranga-gold to-teranga-clay` — never use single-color green/amber/red. Scarcity is conveyed by the clay end stop plus the accompanying "Plus que N places" pill.

### Pulse Dot

`inline-block h-1.5 w-1.5 rounded-full bg-teranga-green teranga-pulse-dot`. Paired with a tabular-nums counter (`event.registeredCount`) to signal live data. Respects `prefers-reduced-motion`.

### Pills & Status chips

Replaces the hex-gradient "status" table from v1 — editorial pills use semantic tokens and sit closer to 11px.

| Tone | Light classes | Dark classes | Typical use |
|------|---------------|--------------|-------------|
| `green` | `bg-teranga-green/10 text-teranga-green border-teranga-green/30` | same | Confirmed, present |
| `gold` | `bg-teranga-gold-whisper text-teranga-gold-dark border-teranga-gold/30` | `bg-teranga-gold/15 text-teranga-gold-light border-teranga-gold/30` | Pending, pending-payment, waitlisted |
| `navy` | `bg-teranga-navy text-white border-teranga-navy` | `bg-teranga-gold text-teranga-navy` | Checked-in, emphasized filter chip |
| `clay` | `bg-teranga-clay/10 text-teranga-clay border-teranga-clay/30` | same | Urgency, cancelled, overdue |
| `muted` | `bg-muted text-muted-foreground border-border` | same | Archived, refunded |
| `destructive` | `bg-destructive/10 text-destructive` | same | Sold-out, error |

All pills: `inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium`.

---

## Status Badges

Small inline indicators for event/registration status.

```tsx
<span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClasses}`}>
  {statusLabel}
</span>
```

- **Shape**: `rounded-full` (pill)
- **Padding**: `px-2 py-1` (or `px-1.5 py-0.5` for compact)
- **Font**: `text-xs font-semibold`
- Colors: See Status Colors in design-tokens.md

---

## Tables

Used in backoffice for event lists, registration lists, etc.

- **Header**: `text-xs font-semibold text-gray-500 uppercase tracking-wider`
- **Rows**: `border-b border-gray-100`, hover `bg-gray-50`
- **Cell padding**: `px-4 py-3`
- **Empty state**: Centered illustration + text + CTA
- **Loading state**: Skeleton rows with `animate-pulse`
- **Responsive**: Horizontal scroll on mobile, or card-based layout below `md` breakpoint

---

## Modals / Dialogs

- **Backdrop**: `bg-black/50`, `z-50`
- **Container**: White, `rounded-2xl`, `shadow-2xl`, `max-w-md` or `max-w-lg`
- **Padding**: `p-6` or `p-8`
- **Header**: Title (h3) + optional close button (X icon, top-right)
- **Footer**: Action buttons aligned right, gap-3
- **Animation**: Fade in backdrop, scale up dialog (200ms)

### Confirmation Dialog

```
+----------------------------------+
|              ⚠️ Icon              |
| "Etes-vous sur ?"               |
| Description text                 |
|                                  |
| [Annuler]  [Confirmer]          |
+----------------------------------+
```

---

## Toast Notifications

- **Position**: Top-right on desktop, top-center on mobile
- **Duration**: 4 seconds (auto-dismiss), persistent for errors
- **Variants**: Success (green), Error (red), Info (blue), Warning (amber)
- **Structure**: Icon + message text + optional close button
- **Animation**: Slide in from right, fade out

---

## Navigation

### Sidebar (Backoffice)

- **Width**: 240px (`w-60`)
- **Background**: Navy (`#1A1A2E`)
- **Items**: White text, 60% opacity when inactive, 100% when active
- **Active indicator**: `bg-white/15` background, `font-medium`
- **Hover**: `bg-white/10`
- **Logo**: Top of sidebar with brand accent

### Bottom Navigation (Participant Web Mobile)

- **Height**: 64px
- **Items**: 4-5 max, icon + label
- **Active**: Navy icon, semibold label
- **Inactive**: Gray icon and label

### Top Bar (Backoffice)

- **Height**: 56px (`h-14`)
- **Background**: White with bottom border
- **Content**: Left empty (breadcrumbs future), Right: notifications + avatar + role badge + logout

---

## Empty States

Every list/table must have an empty state:

```
+----------------------------------+
|         [Illustration]           |
|   "Aucun evenement"              |
|   "Creez votre premier..."       |
|   [CTA Button]                   |
+----------------------------------+
```

- Illustration: Simple line drawing or icon (64px)
- Title: `text-gray-700 font-semibold`
- Description: `text-gray-500 text-sm`
- CTA: Primary button

---

## Loading States

| Context | Pattern |
|---------|---------|
| Page load | Full-page skeleton with content shape |
| List/table | 3-5 skeleton rows with `animate-pulse` |
| Button action | Button text replaced with spinner, button disabled |
| Card | Gray rectangles matching card layout |
| Image | Gray placeholder with image icon |

---

## Error States

| Context | Pattern |
|---------|---------|
| API error | Toast notification (red) with retry option |
| Form validation | Inline error below field, red border |
| Page-level error | Centered error message with retry button |
| Network error | Banner at top: "Connexion perdue. Verifiez votre reseau." |
| 404 | Friendly illustration + "Page introuvable" + back button |
