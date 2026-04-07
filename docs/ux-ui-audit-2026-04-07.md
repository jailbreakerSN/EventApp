# Teranga Platform — Comprehensive UX/UI Audit Report

**Date:** April 7, 2026
**Scope:** Web Backoffice + Web Participant + Shared-UI Component Library
**Benchmark:** Eventbrite, Luma, Linear, Notion, Meetup

---

## Executive Summary

The Teranga platform has a **solid foundation** — clean visual design, good color system with dark mode, proper loading/error states on most pages, and strong registration flow. However, the audit reveals **significant gaps** that would prevent it from meeting production-quality standards:

| Area | Score | Status |
|------|-------|--------|
| Visual Design & Branding | 75% | Good — dark mode, brand colors, consistent cards |
| Layout & Navigation | 55% | Sidebar not mobile-responsive (CRITICAL) |
| Forms & Inputs | 50% | No shared form components, inconsistent validation |
| Accessibility (WCAG 2.1) | 30% | Major gaps — ARIA labels, keyboard nav, focus management |
| Responsive Design | 40% | Backoffice breaks on mobile/tablet |
| Component Library | 25% | Only 8 of 25+ needed components exist in shared-ui |
| Event Discovery (Participant) | 60% | Missing filters (price, date, location) |
| Auth Flow | 55% | No forgot password, no email verification |

**Top 5 priorities for immediate action:**

1. **Mobile-responsive sidebar** — backoffice unusable on tablets (organizers use these at events)
2. **Forgot password flow** — blocking for any real user deployment
3. **Shared-UI component expansion** — Select, Textarea, Modal, Tabs, Skeleton, Table
4. **ARIA labels + keyboard navigation** — 30% WCAG compliance is a liability
5. **Event discovery filters** — price, date, location filters missing

---

## CRITICAL Issues (Must Fix Before Launch)

### C1. Backoffice Sidebar Not Mobile-Responsive
**Files:** `apps/web-backoffice/src/components/layouts/sidebar.tsx`, `(dashboard)/layout.tsx`
- Sidebar is fixed `w-60` with no collapse/hamburger on small screens
- Organizers frequently use tablets at event venues — backoffice is **unusable** below 1024px
- **Fix:** Add hamburger toggle, slide-out drawer on mobile, collapse to icons on tablet

### C2. No Forgot Password Flow
**Files:** `apps/web-participant/src/app/(auth)/login/login-form.tsx`, `apps/web-backoffice/src/app/(auth)/login/login-form.tsx`
- Neither app has a "Forgot password?" link
- No email verification after registration
- **Fix:** Add Firebase `sendPasswordResetEmail()` flow + verification email on signup

### C3. Shared-UI Has Only 8 of 25+ Needed Components
**File:** `packages/shared-ui/src/components/`
- **Implemented:** Button, Card, Input, Badge, Spinner, Toaster, ConfirmDialog, ThemeToggle
- **Missing (heavily used in apps as raw HTML):**
  - Select/ComboBox (25+ raw `<select>` tags across apps)
  - Textarea (raw `<textarea>` in communications, event forms)
  - Modal/Dialog (only ConfirmDialog exists, no generic)
  - Tabs (event detail has 10 tabs, hand-coded)
  - Table (backoffice lists all use raw `<table>`)
  - Pagination (custom in participant app, none in backoffice)
  - Skeleton/Loading (referenced in design docs, not implemented)
  - Avatar, Tooltip, Dropdown, Switch, Radio, Checkbox, DatePicker, Breadcrumb, Alert, EmptyState, SearchInput

### C4. WCAG Accessibility at ~30%
**Across all apps:**

| Gap | Impact | WCAG Level |
|-----|--------|-----------|
| No `aria-label` on icon-only buttons | Screen readers can't identify buttons | A (FAIL) |
| ConfirmDialog missing `aria-labelledby` | Dialog not labeled for screen readers | A (FAIL) |
| No keyboard trap prevention in modals | Focus not managed on open/close | A (FAIL) |
| Input missing `aria-describedby` for errors | Errors not linked to fields | A |
| No skip-to-content link | Keyboard users must tab through sidebar | A |
| No `aria-current="page"` on active nav | Current page not announced | AA |
| Small touch targets (Button sm = 32px) | Mobile users can't reliably tap (min 44px) | AAA |
| No `prefers-reduced-motion` support | Harmful for vestibular disorders | AA (FAIL) |

### C5. Payment Status Page Has No Polling
**File:** `apps/web-participant/src/app/(authenticated)/register/[eventId]/payment-status/page.tsx`
- After payment redirect, page shows loading spinner indefinitely
- No auto-refresh/polling to check payment status
- User must manually refresh — **terrible UX for a payment flow**
- **Fix:** Add 5-second polling with max 12 retries + manual refresh button

---

## HIGH Priority Issues

### H1. Missing Event Discovery Filters (Participant)
**File:** `apps/web-participant/src/components/event-filters.tsx`
- Only has: search, category, format
- **Missing:** Price filter (free/paid/range), date filter (today/week/month), location filter (city), distance/radius
- Essential for Senegal market where users filter by "free events in Dakar this weekend"

### H2. Event Detail Tabs Don't Persist in URL (Backoffice)
**File:** `apps/web-backoffice/src/app/(dashboard)/events/[eventId]/page.tsx`
- 10 tabs (Infos, Billets, Inscriptions, Paiements, Sessions, Feed, Zones, Intervenants, Sponsors, Promos)
- Refreshing page resets to first tab
- Tab bar likely overflows on mobile with no horizontal scroll
- **Fix:** Store active tab in URL query param (`?tab=inscriptions`)

### H3. No Real-Time Form Validation
**Files:** Event creation wizard, registration forms, login forms
- Validation only triggers on submit
- No green checkmarks for valid fields, no inline hints
- No character counter on description/textarea fields
- **Fix:** Add `onBlur` validation + visual feedback per field

### H4. Tables Missing Standard Features (Backoffice)
**File:** `apps/web-backoffice/src/app/(dashboard)/events/page.tsx`
- No column sorting (date, status, registered count)
- No bulk selection/actions (archive multiple events)
- No column visibility toggle
- Truncated text has no tooltip on hover
- **Fix:** Add sortable headers, row checkboxes, column settings

### H5. ConfirmDialog Accessibility & Dark Mode Broken
**File:** `packages/shared-ui/src/components/confirm-dialog.tsx`
- Hardcoded colors: `text-gray-900`, `border-gray-200`, `bg-[#1A1A2E]`
- No `aria-labelledby`, no focus trap, no escape key handling
- Will render incorrectly in dark mode
- **Fix:** Replace with CSS variables, add proper ARIA + focus management

### H6. No Email Verification After Registration
**Files:** Both auth apps
- User registers and immediately gets access
- No verification email sent, no "check your email" screen
- **Fix:** Firebase `sendEmailVerification()` + verification gate

### H7. Badge Variants Missing Dark Mode Support
**File:** `packages/shared-ui/src/components/badge.tsx`
- Success variant uses `bg-emerald-100 text-emerald-700` — low contrast in dark mode
- Warning variant uses `bg-amber-100 text-amber-700` — same issue
- Role badge colors (Super Admin purple, Staff orange) not in shared component
- **Fix:** Add dark mode overrides for all badge variants

### H8. No Skeleton Loaders
**Across all apps:**
- Loading states show "Chargement..." text or a centered spinner
- No skeleton placeholders that match content layout
- **Best practice:** Skeleton loaders reduce perceived load time by 40%+
- **Fix:** Add Skeleton component to shared-ui, use in all list/card views

---

## MEDIUM Priority Issues

### M1. Inconsistent Label Styling in Forms
- Some labels: `text-sm font-medium`, others: `text-xs font-medium`
- No shared FormField/FormLabel component
- **Fix:** Create shared FormField wrapper with consistent styling

### M2. No Breadcrumb Navigation (Backoffice)
- Event detail page only has a back button
- No path context (Dashboard > Events > Dakar Tech Summit)
- **Fix:** Add Breadcrumb component to shared-ui

### M3. Dashboard Missing Trend Indicators
**File:** `apps/web-backoffice/src/app/(dashboard)/dashboard/page.tsx`
- 4 stat cards with raw numbers, no delta/trend
- No comparison period (vs last week/month)
- **Fix:** Add sparkline or up/down arrow with percentage change

### M4. No Command Palette / Keyboard Shortcuts (Backoffice)
- Power users (organizers managing many events) need quick navigation
- No Cmd+K search, no keyboard shortcuts
- **Fix:** Add command palette component (Phase 2)

### M5. Event Description Has No Markdown/Rich Text
**File:** `apps/web-participant/src/app/(public)/events/[slug]/page.tsx` (line 231)
- Description rendered with `whitespace-pre-line` — plain text only
- Organizers can't add headers, bold, links, or lists
- **Fix:** Add markdown rendering for display, rich text editor for input

### M6. Static Params Limited to 50 Events
**File:** `apps/web-participant/src/app/(public)/events/[slug]/page.tsx` (line 29-36)
- `generateStaticParams()` only generates 50 event pages
- Events beyond 50 fall back to SSR — slower for users
- **Fix:** Increase limit or implement ISR with revalidation

### M7. No "Add to Calendar" Feature (Participant)
- After registration, no option to add event to Google Calendar / Apple Calendar / .ics
- Standard feature on Eventbrite, Luma, Meetup
- **Fix:** Generate .ics download link + Google Calendar URL

### M8. Footer Missing Essential Links (Participant)
**File:** `apps/web-participant/src/components/layouts/footer.tsx`
- Only 2 links: "Tous les evenements" + organizer portal
- Missing: Privacy policy, Terms of service, Contact, Social links, FAQ
- **Fix:** Add standard footer sections

### M9. No Similar Events / Recommendations
**File:** `apps/web-participant/src/app/(public)/events/[slug]/page.tsx`
- Event detail page ends after description — no "You might also like"
- No category-based or location-based recommendations
- **Fix:** Add "Similar events" section below event details

### M10. Spinner `aria-label` Hardcoded to French
**File:** `packages/shared-ui/src/components/spinner.tsx`
- `aria-label="Chargement"` not configurable
- Won't work for English/Wolof users
- **Fix:** Accept `aria-label` as prop with French default

---

## LOW Priority Issues

### L1. No Newsletter Signup on Homepage (Participant)
### L2. No Testimonials/Social Proof on Landing Page
### L3. No Event Reviews/Ratings System
### L4. No "Save for Later" / Wishlist Feature
### L5. No Organizer Profile Pages
### L6. No Map View for Event Discovery
### L7. Dashboard Cards Not Customizable (Backoffice)
### L8. No Export Analytics Feature (Backoffice)
### L9. No 2FA Option for Backoffice Login
### L10. No Account Switcher for Multi-Organization Users

---

## Implementation Roadmap

### Phase 1: Critical Fixes (1 week)
1. Mobile-responsive sidebar with hamburger menu
2. Forgot password + email verification flows
3. Payment status page polling
4. ConfirmDialog accessibility + dark mode fix
5. ARIA labels on all interactive elements

### Phase 2: Shared-UI Expansion (1-2 weeks)
1. Select/ComboBox component
2. Textarea component with character counter
3. Modal/Dialog component with focus trap
4. Tabs component with URL persistence
5. Table component with sorting + selection
6. Skeleton loader component
7. Breadcrumb component
8. FormField wrapper with label + error + help text

### Phase 3: UX Enhancements (1-2 weeks)
1. Event discovery filters (price, date, location)
2. Real-time form validation
3. Skeleton loaders on all list pages
4. Tab URL persistence on event detail
5. Badge dark mode variants
6. Trend indicators on dashboard
7. Similar events recommendations

### Phase 4: Competitive Features (2+ weeks)
1. Command palette (Cmd+K)
2. Markdown/rich text for event descriptions
3. Add to Calendar integration
4. Keyboard shortcuts
5. Full WCAG 2.1 AA compliance audit
6. Map view for events
7. Newsletter signup

---

## Design System Gap Summary

| Category | Documented in Design System | Implemented in Shared-UI | Gap |
|----------|----------------------------|--------------------------|-----|
| Brand Colors | 8 colors | Partial (Button, Badge) | No gold variant button |
| Status Colors | 8 statuses | NONE — hardcoded in apps | CRITICAL |
| Role Badge Colors | 5 roles | NONE — hardcoded in apps | CRITICAL |
| Typography Scale | 9 levels | NONE — apps use raw Tailwind | HIGH |
| Z-Index Scale | 8 levels | NONE — hardcoded values | HIGH |
| Motion/Animation | 3 speeds | Only Spinner | MEDIUM |
| Spacing Scale | 16+ values | Inconsistent usage | MEDIUM |
| Border Radius | 6 values | Good | OK |
| Shadows | 4 levels | Underutilized | LOW |
