# Design Tokens

Design tokens are the atomic values that define the visual language of Teranga. They are implemented in:
- **Web**: TailwindCSS custom theme + CSS variables (`globals.css`)
- **Flutter**: `AppTheme` class (`apps/mobile/lib/core/theme/app_theme.dart`)

---

## Colors

### Brand Colors

| Token | Hex | HSL | Usage | Tailwind Class |
|-------|-----|-----|-------|----------------|
| `teranga-navy` | `#1A1A2E` | `240 28% 14%` | Primary brand, sidebar, buttons, headings | `bg-teranga-navy` / `text-teranga-navy` |
| `teranga-navy-light` | `#16213E` | `222 47% 16%` | Hover state for navy, gradient end | `bg-[#16213E]` |
| `teranga-gold` | `#F5A623` | `38 92% 55%` | Accent, CTAs, highlights, badges | `bg-teranga-gold` / `text-teranga-gold` |
| `teranga-green` | `#0F9B58` | `151 82% 33%` | Success, confirmed status, positive actions | `bg-teranga-green` |

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

**Teranga Gold (Amber scale)**
```
gold-50:  #FFF8EB      gold-500: #E8930A      gold-900: #6E3810
gold-100: #FEECC1      gold-600: #CC7406      gold-950: #401C05
gold-200: #FDDA86      gold-700: #A35509 (text-safe on white)
gold-300: #FCC84B      gold-800: #854310
gold-400: #F5A623 (brand)
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
| Gold on navy | 5.8:1 | AA |
| Gold on white | 2.7:1 | **FAIL** — use only for decorative, not text |
| White on navy | 15.4:1 | AA/AAA |
| Gray-700 on white | 8.6:1 | AA/AAA |
| Gray-500 on white | 4.6:1 | AA (normal text) |

> **Important**: Gold (#F5A623) on white does NOT pass contrast. Use gold only on navy backgrounds, as decorative accents, or with a darker gold variant (#B8860B) for text on white.

---

## Typography

### Font Family

- **Primary (body)**: [Inter](https://fonts.google.com/specimen/Inter) — Variable weight, excellent French diacritic support (e, e, a, c, etc.), highly legible on screens
- **Display (headings)**: [DM Sans](https://fonts.google.com/specimen/DM+Sans) — Geometric, slightly warmer than Inter, adds personality to headings. Optional — Inter works for both if you prefer simplicity.
- **Fallback**: `system-ui, -apple-system, sans-serif`
- **Monospace** (code, QR values): `ui-monospace, 'JetBrains Mono', 'Fira Code', monospace`

```js
// Tailwind config
fontFamily: {
  sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
  display: ['DM Sans', 'Inter', 'system-ui', 'sans-serif'],
  mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
}
```

### Type Scale

Based on TailwindCSS defaults, used consistently across web and mobile:

| Token | Size | Line Height | Weight | Usage |
|-------|------|-------------|--------|-------|
| `display` | 36px (text-4xl) | 1.1 | 800 (extrabold) | Landing page hero |
| `h1` | 30px (text-3xl) | 1.2 | 700 (bold) | Page titles |
| `h2` | 24px (text-2xl) | 1.3 | 700 (bold) | Section headings |
| `h3` | 20px (text-xl) | 1.4 | 600 (semibold) | Card titles, subsections |
| `h4` | 18px (text-lg) | 1.4 | 600 (semibold) | Subheadings |
| `body` | 14px (text-sm) | 1.5 | 400 (normal) | Default body text |
| `body-lg` | 16px (text-base) | 1.5 | 400 (normal) | Prominent body text |
| `caption` | 12px (text-xs) | 1.5 | 400 (normal) | Timestamps, metadata |
| `overline` | 10px (text-[10px]) | 1.5 | 600 (semibold) | Labels, badges |

### Font Weight Map

| Weight | Name | Usage |
|--------|------|-------|
| 400 | Normal | Body text, descriptions |
| 500 | Medium | Navigation items, table cells |
| 600 | Semibold | Buttons, labels, card titles |
| 700 | Bold | Page headings, emphasis |
| 800 | Extrabold | Display/hero text only |

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

| Token | Value | CSS Variable | Usage |
|-------|-------|-------------|-------|
| `radius-sm` | 4px | `calc(var(--radius) - 4px)` | Small elements (badges, tags) |
| `radius-md` | 6px | `calc(var(--radius) - 2px)` | Inputs, selects |
| `radius-lg` | 8px | `var(--radius)` | Cards, buttons, panels |
| `radius-xl` | 12px | — | Larger cards (Flutter uses 12px) |
| `radius-2xl` | 16px | — | Modal dialogs, feature cards |
| `radius-full` | 9999px | — | Avatars, status dots, badges |

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

TailwindCSS: `transition-colors` (default 150ms) is used for interactive element hover states.

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
