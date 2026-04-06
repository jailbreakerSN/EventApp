# Component Patterns

Reusable UI patterns used across both web applications. These will be implemented in `packages/shared-ui/` as the shared component library.

---

## Buttons

### Variants

| Variant | Appearance | Usage |
|---------|-----------|-------|
| **Primary** | Navy background, white text | Main actions: "Creer", "S'inscrire", "Publier" |
| **Secondary** | White background, navy border | Secondary actions: "Annuler", "Retour" |
| **Ghost** | Transparent, gray text | Tertiary actions: "Voir plus", icon-only buttons |
| **Destructive** | Red background, white text | Dangerous actions: "Supprimer", "Annuler l'evenement" |
| **Gold** | Gold background, navy text | Feature CTAs: "Mettre a niveau", "Fonctionnalite premium" |

### Sizes

| Size | Height | Padding | Font Size | Touch Target |
|------|--------|---------|-----------|-------------|
| `sm` | 32px | `px-3 py-1.5` | 12px (text-xs) | 32px min |
| `md` | 40px | `px-4 py-2.5` | 14px (text-sm) | 44px (with spacing) |
| `lg` | 48px | `px-6 py-3` | 16px (text-base) | 48px |

### States

- **Default**: Solid background
- **Hover**: Slightly lighter (`#16213E` for navy)
- **Focus**: 2px ring with `ring-[#1A1A2E]/20` offset
- **Disabled**: `opacity-60`, `cursor-not-allowed`
- **Loading**: Spinner replaces text, maintains button width

### Implementation

```tsx
// Primary button pattern (current in backoffice)
<button className="inline-flex items-center gap-2 bg-[#1A1A2E] text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[#16213E] transition-colors disabled:opacity-60">
  <Icon className="h-4 w-4" />
  Label
</button>
```

---

## Cards

### Event Card (Participant)

Used in event discovery listings. Mobile-first responsive.

```
+----------------------------------+
| [Cover Image - 16:9 ratio]      |
+----------------------------------+
| Category Badge    Status Badge   |
| Event Title (h3, semibold)       |
| 📅 Date  📍 Location             |
| 🏷️ Price (or "Gratuit")          |
| [Register CTA Button]           |
+----------------------------------+
```

- **Image**: `aspect-[16/9]`, `object-cover`, rounded top corners
- **Loading**: Skeleton placeholder with `animate-pulse`
- **Hover**: Subtle shadow increase (`shadow-sm` → `shadow`)

### Event Card (Backoffice)

Used in organizer event list. Table row style.

```
| Title | Status Badge | Date | Location | Registered | Actions |
```

- Status badge uses semantic colors from design tokens
- Actions: Edit, Publish/Unpublish, View, Archive

### Stat Card (Dashboard)

```
+------------------+
| Icon    Label    |
| VALUE (text-3xl) |
| +12% vs last     |
+------------------+
```

- Background: White, border, rounded-xl
- Icon: 40px circle with muted brand color background
- Value: Large bold number
- Trend: Green up / Red down indicator

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

For complex flows (event creation, registration with payment):

```
Step 1        Step 2        Step 3        Step 4
[●]──────────[○]──────────[○]──────────[○]
Details     Tickets     Parametres   Apercu
```

- **Active step**: Navy circle with white number
- **Completed step**: Green checkmark
- **Upcoming step**: Gray circle with gray number
- **Step labels**: `text-xs` below circles
- **Navigation**: "Precedent" (secondary) + "Suivant" (primary) buttons

### Form Layout

- **Spacing**: `space-y-4` between fields
- **Labels**: Above inputs, never floating
- **Required fields**: Red asterisk after label text
- **Help text**: `text-xs text-gray-500` below input
- **Error text**: `text-xs text-red-500 mt-1` below input, replaces help text

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
