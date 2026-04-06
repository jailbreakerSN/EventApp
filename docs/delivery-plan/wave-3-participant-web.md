# Wave 3: Participant Web App

**Status:** `not_started`
**Estimated effort:** 1.5 weeks
**Goal:** Launch a participant-facing web application for event discovery, registration, and badge viewing — with SEO-optimized public pages.

## Why This Wave Matters

Mobile-only limits reach. Many participants discover events via WhatsApp links, Google search, or social media — all of which land on a web page. A fast, SEO-indexed web experience is critical for event promotion in Senegal, where WhatsApp is the primary sharing channel. Flutter Web was evaluated and rejected due to canvas-based rendering (no SEO), 2-3 MB payload (hostile to African networks), and poor accessibility.

## Architecture Decision

**Approach:** New `apps/web-participant/` Next.js 14 app (Option B from architecture evaluation).

**Why not Flutter Web?**
- Canvas rendering = no Google indexing (dealbreaker for event discovery)
- 2-3 MB CanvasKit WASM = 8-15s load on 3G networks
- No Open Graph tags = no WhatsApp rich previews
- Poor accessibility (screen readers cannot parse canvas)

**Why not extend the backoffice?**
- Fundamentally different UX (discovery vs management)
- Coupled deployments and growing routing complexity
- Bundle bloat from organizer-only libraries (charts, admin forms)

**Why a separate Next.js app?**
- SSR/SSG for instant load and SEO indexing
- Rich Open Graph tags for WhatsApp/social sharing
- Same stack as backoffice = massive code reuse via shared packages
- Independent deployment and performance budget
- Incremental feature addition wave by wave

---

## Tasks

### Monorepo Setup

- [ ] Create `packages/shared-ui/` — extract reusable React components from backoffice
  - [ ] Button, Card, Input, Modal, Badge, Spinner components
  - [ ] Shared Tailwind preset (colors, fonts, spacing — Teranga design tokens)
  - [ ] Package.json with `@teranga/shared-ui` name
- [ ] Create `packages/shared-config/` — shared ESLint and Tailwind configs
- [ ] Create `apps/web-participant/` — Next.js 14 App Router scaffold
  - [ ] TailwindCSS + shared design tokens
  - [ ] Firebase Auth client setup (reuse pattern from backoffice)
  - [ ] API client (extract shared fetch wrapper from backoffice into shared-lib or copy)
  - [ ] React Query provider
  - [ ] Mobile-first responsive layout
- [ ] Update `turbo.json` build pipeline for new packages and app
- [ ] Add Firebase Hosting target for participant app in `firebase.json`

### Public Pages (No Auth — SSG/ISR for SEO)

- [ ] Landing page with featured events
- [ ] Event listing page with search, category filters, and pagination
  - [ ] Server-side rendered with ISR (revalidate every 60s)
  - [ ] Calls `GET /v1/events` (public search endpoint)
- [ ] Event detail page (`/events/[slug]`)
  - [ ] SSG with `generateStaticParams` for published events
  - [ ] Full `generateMetadata()` — title, description, OG image, event schema.org JSON-LD
  - [ ] Rich Open Graph tags for WhatsApp/Facebook/Twitter sharing
  - [ ] Ticket types display, location map, schedule preview
  - [ ] "Register" CTA button (redirects to auth if not logged in)

### Authenticated Pages (Client-rendered with React Query)

- [ ] Auth flow — login/register pages (reuse pattern from backoffice)
  - [ ] Firebase Auth (email/password, Google)
  - [ ] Post-login redirect back to intended page
- [ ] Registration flow (`/events/[eventId]/register`)
  - [ ] Ticket type selection
  - [ ] Confirmation step
  - [ ] Success screen with QR code display
  - [ ] Calls `POST /v1/registrations`
- [ ] My events page — list of user's registrations with status badges
  - [ ] Calls `GET /v1/registrations/me`
  - [ ] Cancel registration action
- [ ] My badges page — QR code display and PDF download
  - [ ] Calls `GET /v1/badges/me/:eventId`
  - [ ] QR code rendering (client-side, e.g., `qrcode.react`)
  - [ ] PDF download link
- [ ] Profile page — view/edit user profile
  - [ ] Calls `GET /v1/users/me` and `PATCH /v1/users/me`

### Shared Types & API

- [ ] Verify all participant API endpoints exist (most from Wave 1 — should be ready)
- [ ] Add `GET /v1/events/by-slug/:slug` route if not already present (for SSG)
- [ ] Ensure public endpoints return SEO-relevant fields (description, image, location)

---

## Exit Criteria

- [ ] Public event pages are Google-indexable (verify with Lighthouse SEO audit)
- [ ] Event detail page shows rich preview when shared on WhatsApp
- [ ] Participant can discover events, register, and view badge — all via web
- [ ] Page loads under 2 seconds on simulated 3G (Lighthouse performance > 80)
- [ ] Mobile-first responsive design works on phone, tablet, and desktop
- [ ] Authenticated routes redirect to login; login redirects back after auth
- [ ] Deployed to separate Firebase Hosting target

## Dependencies

- Wave 1 completed (event CRUD, registration, badge APIs exist)
- Shared-ui extraction happens as part of this wave's monorepo setup tasks

## Deploys After This Wave

- `apps/web-participant/` on Firebase Hosting (separate target from backoffice)
- `packages/shared-ui/` and `packages/shared-config/` as internal monorepo packages
- No API changes needed (reuses existing endpoints)

## Technical Notes

- **SSG for event pages**: Use `generateStaticParams` with ISR revalidation (60s). Fallback to SSR for new events not yet in the static cache.
- **OG tags**: Use `generateMetadata()` with event title, description (first 160 chars), cover image URL. Add `schema.org/Event` JSON-LD for rich Google results.
- **Auth redirect**: Store the intended URL in sessionStorage before redirecting to login. After login, redirect back.
- **QR code rendering**: Use `qrcode.react` library (lightweight, no server dependency). Display the `qrCodeValue` from the registration record.
- **Shared UI extraction**: Start with the simplest components (Button, Card, Input). Don't over-abstract — extract only what both apps actually use.
- **Firebase Hosting multi-site**: Add `"participant"` target in `firebase.json` alongside the existing backoffice target.
