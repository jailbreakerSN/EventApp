# @teranga/shared-ui

> **Status: shipped** — Used by both web-backoffice and web-participant.

Package: `packages/shared-ui/`  
Import: `import { Button, DataTable, EmptyState } from '@teranga/shared-ui'`

---

## Purpose

`@teranga/shared-ui` is the Teranga design system component library for React. It provides:
- Consistent UI primitives (Button, Input, Card, Badge, Tabs, etc.)
- Data display components (DataTable with loading/empty states, Skeleton)
- Navigation and layout (Breadcrumb, Pagination, SectionHeader)
- Platform-specific components (EditorialEventCard, CapacityBar, OfflineBanner)
- Utility functions (formatDate, formatCurrency, getStatusVariant)

---

## Component catalogue

### Form & input

| Component | Props | Notes |
|---|---|---|
| `Button` | `variant`, `size`, `loading`, `disabled` | Variants: default, secondary, outline, ghost, destructive |
| `Input` | Standard HTML input props + `error` | |
| `Select` | `options`, `value`, `onChange` | |
| `Textarea` | Standard + `error` | |
| `Switch` | `checked`, `onChange`, `disabled` | |
| `RadioGroup` | `options`, `value`, `onChange` | |
| `Stepper` | `steps`, `currentStep` | Multi-step wizard progress |
| `FileUpload` | `accept`, `maxSize`, `onUpload` | |

### Layout & structure

| Component | Notes |
|---|---|
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | Standard card layout |
| `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, etc. | Navigation breadcrumb |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Tab navigation |
| `Pagination` | Page-based pagination |
| `SectionHeader` | Section title + optional action button |

### Data display

| Component | Notes |
|---|---|
| `DataTable` | Generic table with columns config, loading skeleton, empty state, responsive card view on mobile |
| `Badge` | Status badge — variants: default, secondary, destructive, outline, success, warning, info, pending, neutral, premium |
| `Spinner` | Loading spinner |
| `Skeleton` | Loading skeleton with variant shapes |
| `Avatar` | User avatar with fallback initials |

### Navigation & messaging

| Component | Notes |
|---|---|
| `LanguageSwitcher` | FR / EN / WO switcher |
| `Toaster` | Sonner-based toast notifications |
| `Tooltip` | Accessible tooltip |
| `ThemeToggle` | Light/dark mode toggle |

### Platform-specific

| Component | Notes |
|---|---|
| `EmptyState` | Icon + title + description + optional CTA button |
| `QueryError` | Error UI with retry button — for React Query error boundaries |
| `OfflineBanner` | Yellow banner when device is offline |
| `ConfirmDialog` | Confirmation dialog with destructive/confirm actions |
| `EditorialEventCard` | High-fidelity event card for participant app discovery feed |
| `CapacityBar` | Progress bar showing zone/event capacity |
| `LogoLoader` | Full-screen loading overlay with Teranga logo |
| `SearchInput` | Search field with debounce and clear button |

---

## Utility functions

| Function | Signature | Description |
|---|---|---|
| `formatDate` | `(date: string, locale?: string) => string` | Locale-aware date formatting (fr-SN default) |
| `formatDateTime` | `(date: string, locale?: string) => string` | Date + time |
| `formatCurrency` | `(amount: number, currency?: string) => string` | XOF formatting: `fr-SN` `Intl.NumberFormat` |
| `cn` | `(...classes: string[]) => string` | `clsx` + `tailwind-merge` for class composition |
| `getErrorMessage` | `(error: unknown) => string` | Extracts message from API error response |
| `getStatusVariant` | `(status: string) => BadgeVariant` | Maps status strings to Badge variants |

---

## Theming

Components use CSS variables defined in the consuming app's global CSS. The Teranga palette:

| Token | Light | Dark |
|---|---|---|
| `--primary` | teranga-navy (#1A1A2E) | teranga-gold (#D4AF37) |
| `--background` | white | teranga-forest (#152a20) |
| `--card` | white | navy-dark |
| `--foreground` | slate-900 | slate-100 |
| `--muted` | slate-100 | slate-800 |
| `--border` | slate-200 | slate-700 |
| `--teranga-gold` | #D4AF37 | #E8C547 |
| `--teranga-green` | #2E8B57 | #3da066 |

---

## Adding a new component

1. Create `packages/shared-ui/src/components/MyComponent.tsx`
2. Export from `packages/shared-ui/src/index.ts`
3. Write a Storybook story or Vitest component test
4. Consume in either web app: `import { MyComponent } from '@teranga/shared-ui'`
