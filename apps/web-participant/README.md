# `@teranga/web-participant`

Teranga participant **Next.js 14** web app. Public-facing event discovery, registration, badge display, social feed, and messaging. Optimized for African network conditions (slow 3G/4G) and WhatsApp sharing.

> **Canonical reference:** [`docs-v2/40-clients/web-participant.md`](../../docs-v2/40-clients/web-participant.md).
> **Status:** ~70% shipped (Wave 3). Speaker/sponsor portals and full SEO metadata coverage are pending Wave 5+.

## Tech

- **Next.js 14** App Router with **SSR/SSG** for SEO + WhatsApp link previews.
- **TailwindCSS** + **`@teranga/shared-ui`** components.
- **Firebase Web SDK** for auth, real-time feed/messaging streams, and FCM push.
- **next/image** + AVIF/WebP for image performance on slow networks.
- French-first (`fr-SN`); English + Wolof i18n.
- Mobile-first responsive design, 320–768 px primary target.

## Routing highlights

- `/` — discovery (upcoming events near the user).
- `/events/[slug]` — event detail page (SSG).
- `/register/[eventId]` — registration flow.
- `/me/badge/[registrationId]` — participant badge page (QR code visible).
- `/feed` — event social feed.
- `/messages` — messaging threads.

## Local dev

```bash
# 1. Set up env (one-time)
cp apps/web-participant/.env.example apps/web-participant/.env.local

# 2. Build shared deps
npm run types:build
npx turbo build --filter=@teranga/shared-ui

# 3. Start the API + (optionally) backoffice
npm run api:dev
# new terminal: npm run participant:dev → http://localhost:3002
```

## SEO + sharing

- Every event page sets `<meta property="og:*">` and Twitter card tags.
- Server-rendered for fast first paint and crawl-friendly markup.
- WhatsApp link previews tested manually before each release (see [`docs-v2/50-operations/ci-cd.md`](../../docs-v2/50-operations/ci-cd.md)).

## Performance budgets

- **LCP** < 2.5s on simulated 3G.
- **TTI** < 4s.
- **JS bundle (per route)** < 150 KB gzipped.

Tracked via Lighthouse CI on every PR (`.github/workflows/lighthouse-ci.yml`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server on port 3002 |
| `npm run build` | Production build |
| `npm run start` | Start built app |
| `npm run lint` | ESLint |
| `npm run type-check` | `tsc --noEmit` |

## Deployment

Firebase Hosting, separate site from the backoffice. Domain: `app.teranga.events` (planned).
