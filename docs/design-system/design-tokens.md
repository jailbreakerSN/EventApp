# Design Tokens

> **Editorial v2 (2026-04-17)** — this is the canonical token sheet after the Teranga Participant prototype handoff. Any new surface in `apps/web-participant` or `apps/web-backoffice` MUST use these tokens; inlined hex / arbitrary `rounded-[...]` values are rejected in review.

Design tokens are the atomic values that define the visual language of Teranga. They are implemented in:
- **Web**: TailwindCSS custom theme (`apps/web-participant/tailwind.config.ts`) + CSS variables and editorial utilities (`src/app/globals.css`)
- **Flutter**: `AppTheme` class (`apps/mobile/lib/core/theme/app_theme.dart`)

---

## Colors

### Brand Colors

| Token | Hex | HSL | Usage | Tailwind Class |
|-------|-----|-----|-------|----------------|
| `teranga-navy` | `#1A1A2E` | `240 28% 14%` | Primary brand, dark CTAs, hero base | `bg-teranga-navy` / `text-teranga-navy` |
| `teranga-navy-2` | `#16213E` | `222 47% 16%` | Hero gradient mid, button hover | `bg-teranga-navy-2` |
| `teranga-navy-3` | `#0F0F1C` | `240 30% 8%` | Deepest navy, rare — text on gold, gradient end | `bg-teranga-navy-3` |
| `teranga-gold` | `#c59e4b` | `38 46% 53%` | Accent, primary gold CTA, pill fills | `bg-teranga-gold` / `text-teranga-gold` |
| `teranga-gold-light` | `#d1b372` | `38 50% 63%` | Gold hover, italic display accent on dark | `bg-teranga-gold-light` |
| `teranga-gold-dark` | `#a78336` | `38 52% 43%` | Gold text on white (WCAG AA), mono kickers | `text-teranga-gold-dark` |
| `teranga-gold-soft` | `#f0e6ce` | `40 60% 87%` | Pale gold surfaces, gold chip background | `bg-teranga-gold-soft` |
| `teranga-gold-whisper` | `#faf6ee` | `42 67% 96%` | Cream paper, ticket stub background | `bg-teranga-gold-whisper` |
| `teranga-green` | `#0F9B58` | `151 82% 33%` | Success, confirmed status, live pulse dot | `bg-teranga-green` |
| `teranga-forest` | `#2a473c` | `160 27% 22%` | Deep teal, hero gradient end | `bg-teranga-forest` |
| `teranga-forest-dark` | `#172721` | `153 27% 12%` | Near-black, dark-mode backgrounds | `bg-teranga-forest-dark` |
| `teranga-clay` | `#c86f4b` | `16 54% 54%` | Urgency / scarcity pills, capacity bar end | `bg-teranga-clay` |

### Semantic Colors

| Token | Light Mode | Usage |
|-------|-----------|-------|
| `background` | `#FFFFFF` | Page background |
| `foreground` | `#0A0A1A` | Primary text |
| `muted` | `#F1F5F9` | Muted backgrounds, disabled states |
| `muted-foreground` | `#64748B` | Secondary text, placeholders |
| `border` | `#E2E8F0` | Borders, dividers |
| `input` | `#E2E8F0` | Input borders |
| `ring` | `#1A1A2E` | Focus ring |
| `destructive` | `#EF4444` | Error, danger, cancelled status |

### Status Colors

Used consistently across event statuses, registration statuses, and system feedback.

| Status | Background | Text | Tailwind Classes |
|--------|-----------|------|------------------|
| Draft / Brouillon | `#F3F4F6` | `#374151` | `bg-gray-100 text-gray-700` |
| Published / Publie | `#DCFCE7` | `#15803D` | `bg-green-100 text-green-700` |
| Confirmed / Confirme | `#DCFCE7` | `#15803D` | `bg-green-100 text-green-700` |
| Pending / En attente | `#FEF3C7` | `#A16207` | `bg-amber-100 text-amber-700` |
| Waitlisted / Liste d'attente | `#DBEAFE` | `#1D4ED8` | `bg-blue-100 text-blue-700` |
| Cancelled / Annule | `#FEE2E2` | `#B91C1C` | `bg-red-100 text-red-700` |
| Archived / Archive | `#FEF9C3` | `#A16207` | `bg-yellow-100 text-yellow-700` |
| Checked-in / Enregistre | `#F3E8FF` | `#7C3AED` | `bg-purple-100 text-purple-700` |

### Role Badge Colors

| Role | Background | Text | Tailwind Classes |
|------|-----------|------|------------------|
| Super Admin | `#F3E8FF` | `#7C3AED` | `bg-purple-100 text-purple-700` |
| Organisateur | `#DCFCE7` | `#15803D` | `bg-green-100 text-green-700` |
| Co-organisateur | `#DBEAFE` | `#1D4ED8` | `bg-blue-100 text-blue-700` |
| Staff | `#FFEDD5` | `#C2410C` | `bg-orange-100 text-orange-700` |
| Participant | `#F3F4F6` | `#4B5563` | `bg-gray-100 text-gray-600` |

### Extended Palette (for future shared-ui implementation)

When building `packages/shared-ui/`, use these extended scales derived from the brand colors:

**Teranga Navy (Indigo scale)**
```
indigo-50:  #E8E8F0    indigo-500: #3B3B6E    indigo-900: #1A1A2E (brand)
indigo-100: #C5C5D6    indigo-600: #2D2D56    indigo-950: #0F0F1C
indigo-200: #9E9EB8    indigo-700: #23234A
indigo-300: #77779A    indigo-800: #1E1E3D
indigo-400: #595984
```

**Teranga Gold (Muted gold scale — aligned with logo)**
```
gold-50:  #FAF6EE      gold-500: #c59e4b (brand)   gold-900: #5a4520
gold-100: #F0E6CE      gold-600: #a78336 (gold-dark) gold-950: #3a2c14
gold-200: #E3D0A5      gold-700: #8a6b2b (text-safe on white)
gold-300: #d1b372 (gold-light)  gold-800: #6e5522
gold-400: #c59e4b (brand)
```

**Warm Grays** (warmer than Tailwind defaults, matches hospitality theme)
```
warm-50:  #FAFAF9      warm-500: #78716C      warm-900: #1C1917
warm-100: #F5F5F4      warm-600: #57534E      warm-950: #0C0A09
warm-200: #E7E5E4      warm-700: #44403C
warm-300: #D6D3D1      warm-800: #292524
warm-400: #A8A29E
```

### Contrast Ratios (WCAG AA)

All text/background combinations must meet WCAG AA (4.5:1 for normal text, 3:1 for large text):

| Combination | Ratio | Passes |
|-------------|-------|--------|
| Navy on white | 15.4:1 | AA/AAA |
| Gold (#c59e4b) on navy | 4.4:1 | AA (large text) |
| Gold (#c59e4b) on white | 3.5:1 | AA (large text only) |
| Gold-dark (#a78336) on white | 4.6:1 | AA |
| Forest (#2a473c) on white | 9.8:1 | AA/AAA |
| Forest-dark (#172721) on white | 15.1:1 | AA/AAA |
| White on navy | 15.4:1 | AA/AAA |
| Gray-700 on white | 8.6:1 | AA/AAA |
| Gray-500 on white | 4.6:1 | AA (normal text) |

> **Important**: Gold (#c59e4b) on white passes AA only for large text (3.5:1). For normal-sized gold text on white, use `teranga-gold-dark` (#a78336, 4.6:1). Gold on navy passes AA for large text (4.4:1).

---

## Typography

### Font Family

Three families, each with a strict role. All loaded via `next/font/google` with CSS variables so swapping / scaling is centralised.

- **Sans (body + UI)** — [Inter](https://fonts.google.com/specimen/Inter). Full diacritic coverage for French + Wolof. CSS variable: `--font-sans`. Preloaded weights 400/500/600/700.
- **Serif (display)** — [Fraunces](https://fonts.google.com/specimen/Fraunces). Variable optical-sizing, italic cut used for gold accents in hero titles. CSS variable: `--font-serif`. Weights 500/600/700 + italic, `preload: false` (loaded lazily to protect 3G payload).
- **Mono (kickers + codes)** — [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono). Used only for: overline kickers, TER codes, tabular numerals on tickets, QR payloads. CSS variable: `--font-mono`. Weights 500/600, `preload: false`.

**Utility classes** (defined in `globals.css` `@layer utilities`):
- `.font-serif-display` — applies Fraunces with `font-optical-sizing: auto` and `letter-spacing: -0.01em`. Use for every editorial headline.
- `.font-mono-kicker` — applies JetBrains Mono. Use for every mono kicker / code chip.

### Type Scale

Editorial hierarchy. Sizes read as "large display → tight tracking"; body remains 15–17px for comfortable French line lengths.

| Token | Size | Line Height | Weight | Tracking | Family | Usage |
|-------|------|-------------|--------|----------|--------|-------|
| `hero-display` | 76px | 0.98 | 500 | `-0.03em` | Serif | Homepage hero title |
| `event-hero` | 68px | 1.0 | 500 | `-0.028em` | Serif | Event detail hero title |
| `success-headline` | 40px | 1.1 | 600 | `-0.025em` | Serif | Registration success + My events hero |
| `h1` | 36px | 1.08 | 600 | `-0.02em` | Serif | Section headlines, "Parcourir la saison" |
| `h2` | 28px | 1.15 | 600 | `-0.02em` | Serif | In-page section titles ("À propos", "Programme") |
| `card-title` | 22px | 1.15 | 600 | `-0.015em` | Serif | Event card + featured tile titles |
| `body-lg` | 17px | 1.65 | 400 | — | Sans | About copy, editorial paragraphs |
| `body` | 15px | 1.5 | 400 | — | Sans | Default body (was 14px — relaxed for FR legibility) |
| `body-sm` | 13px | 1.5 | 500 | — | Sans | Meta rows, ticket fields |
| `caption` | 12px | 1.5 | 500 | — | Sans | Timestamps, microcopy |
| `kicker` | 11px | 1.2 | 500 | `0.14em`, uppercase | Mono | Mono section kickers |
| `kicker-sm` | 10px | 1.2 | 500 | `0.12em`, uppercase | Mono | Ticket field labels, meta-cell labels |

### Font Weight Map

| Weight | Name | Usage |
|--------|------|-------|
| 400 | Normal | Body text, descriptions |
| 500 | Medium | Display (Fraunces) + mono kickers + buttons on dark |
| 600 | Semibold | Display headlines, button labels, card titles |
| 700 | Bold | Inline prices, tabular numerals, emphasis |

---

## Spacing

Based on a **4px base unit** (TailwindCSS default):

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `space-0` | 0 | `p-0` | Reset |
| `space-1` | 4px | `p-1` | Tight internal padding |
| `space-1.5` | 6px | `p-1.5` | Badge/tag padding |
| `space-2` | 8px | `p-2` | Icon buttons, small gaps |
| `space-3` | 12px | `p-3` | Card internal padding (small) |
| `space-4` | 16px | `p-4` | Default internal padding |
| `space-5` | 20px | `p-5` | Section padding |
| `space-6` | 24px | `p-6` | Page horizontal padding |
| `space-8` | 32px | `p-8` | Card large padding, form spacing |
| `space-10` | 40px | `p-10` | Section vertical spacing |
| `space-12` | 48px | `p-12` | Page section gaps |

### Layout Spacing

| Element | Spacing |
|---------|---------|
| Page horizontal padding | `px-6` (24px) |
| Section gap | `space-y-6` (24px) or `mb-6` |
| Card internal padding | `p-6` (24px) or `p-8` (32px) |
| Form field gap | `space-y-4` (16px) |
| Button group gap | `gap-3` (12px) |
| Inline element gap | `gap-2` (8px) |

---

## Border Radius

Editorial radii live as Tailwind tokens — use them instead of `rounded-[14px]` arbitrary values.

| Token | Value | Tailwind Class | Usage |
|-------|-------|----------------|-------|
| `radius-sm` | 4px | `rounded-sm` | Badges, tags, tight inline chips |
| `radius-md` | 6px | `rounded-md` | Inputs, selects |
| `radius-lg` | 8px | `rounded-lg` | Secondary buttons, dense cards |
| `radius-card` | **14px** | `rounded-card` | Event cards, schedule rows, payment cards, empty rows |
| `radius-tile` | **20px** | `rounded-tile` | Featured tiles, sticky panels (ticket sidebar, order summary) |
| `radius-pass` | **22px** | `rounded-pass` | Success ticket + badge pass (the largest radius in the system) |
| `radius-full` | 9999px | `rounded-full` | Avatars, status dots, pill buttons, CTAs |

---

## Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle elevation (cards in list) |
| `shadow` | `0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)` | Default card shadow |
| `shadow-lg` | `0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)` | Dropdowns, popovers |
| `shadow-2xl` | `0 25px 50px rgba(0,0,0,0.25)` | Modals, login card |

---

## Breakpoints

| Token | Min Width | Usage |
|-------|-----------|-------|
| `sm` | 640px | Mobile landscape |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Tablet landscape / small desktop |
| `xl` | 1280px | Desktop |
| `2xl` | 1536px | Large desktop |

### Responsive Strategy

- **Participant web**: Mobile-first (base styles for mobile, `sm:` and up for larger)
- **Backoffice**: Desktop-first with tablet breakpoint at `md:` (organizers use tablets at events)
- **Critical breakpoint**: `md` (768px) — below this, single-column layout; above, multi-column

---

## Motion & Animation

| Token | Duration | Easing | Usage |
|-------|----------|--------|-------|
| `transition-fast` | 150ms | `ease-in-out` | Hover effects, toggles |
| `transition-normal` | 200ms | `ease-in-out` | Color transitions, button states |
| `transition-slow` | 300ms | `ease-in-out` | Page transitions, slide-in panels |
| `ticket-reveal` | 600ms | `cubic-bezier(.2,.7,.2,1)` | Registration success + badge page pass reveal |
| `check-pop` | 400ms | `cubic-bezier(.2,.9,.2,1.2)` | Green checkmark pop on success states |
| `pulse-dot` | 2s | `ease-in-out infinite` | Live inscrits counter dot (`.teranga-pulse-dot`) |

All motion tokens honour `prefers-reduced-motion: reduce` (global rule in `globals.css` collapses durations to 0.001ms). `.teranga-pulse-dot` additionally sets `animation: none` under reduced-motion.

---

## Editorial Utilities

Defined once in `apps/web-participant/src/app/globals.css` `@layer utilities`. Other apps that want the editorial look (web-backoffice, future marketing site) should import the same utility layer.

| Utility | Purpose |
|---------|---------|
| `.font-serif-display` | Fraunces + optical-sizing auto + tight tracking |
| `.font-mono-kicker` | JetBrains Mono for kickers / codes |
| `.teranga-cover` | Gradient cover with grain + diagonal stripe texture (pseudo-elements). Used on every event cover fallback. |
| `.teranga-hero-texture` | Gold + clay radial accents + stripe — applied over the navy gradient hero on the homepage. |
| `.teranga-pulse-dot` | Pulsing green dot for live counters. |

## Cover Gradients (8-palette rotation)

When an event has no `coverImageURL`, fall back to one of eight branded gradients rotated deterministically by `event.id`. Shipped as `apps/web-participant/src/lib/cover-gradient.ts`. Never invent a new gradient inline — always call `getCoverGradient(event.id)`.

| # | Gradient | Tint |
|---|----------|------|
| 0 | `navy → forest → gold` | `#c59e4b` |
| 1 | `clay → gold-dark → forest-dark` | `#c86f4b` |
| 2 | `forest → navy-2 → green` | `#0F9B58` |
| 3 | `gold → clay → navy` | `#c59e4b` |
| 4 | `navy-2 → clay → gold-light` | `#d1b372` |
| 5 | `green → forest → navy` | `#0F9B58` |
| 6 | `navy → navy-3` | `#c59e4b` |
| 7 | `gold-light → gold → gold-dark` | `#a78336` |

The **tint** field is reused by the badge page hero gradient so the navy pass header picks up each event's personality colour.

---

## Z-Index Scale

| Token | Value | Usage |
|-------|-------|-------|
| `z-base` | 0 | Default content |
| `z-elevated` | 10 | Cards above content, sticky headers |
| `z-dropdown` | 30 | Dropdown menus, select popups |
| `z-sticky` | 40 | Sticky sidebar, top bar |
| `z-overlay` | 50 | Modal backdrop |
| `z-modal` | 60 | Modal content |
| `z-toast` | 70 | Toast notifications |
| `z-tooltip` | 80 | Tooltips |
