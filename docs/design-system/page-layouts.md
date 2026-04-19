# Page Layouts

> **Editorial v2 (2026-04-17)** — the participant app follows the Teranga Participant prototype. The container width is `max-w-[1280px] px-6 lg:px-8`; editorial section headers use `SectionHeader` (see `component-patterns.md`). Backoffice retains its v1 layout until the next port phase.

---

## Backoffice Layout (Organizer)

Desktop-first with tablet support. Always authenticated.

```
+--------+------------------------------------------+
| Sidebar|  Top Bar (notifications, avatar, role)    |
| 240px  +------------------------------------------+
|        |                                          |
| Nav    |  Page Content                            |
| items  |  (max-width: none, fluid)                |
|        |  px-6 py-6                               |
|        |                                          |
| Plan   |                                          |
| badge  |                                          |
+--------+------------------------------------------+
```

- **Sidebar**: Fixed, `w-60`, navy background, full height
- **Top bar**: Fixed height `h-14`, white, bottom border
- **Content area**: Fluid width, `px-6` padding, scroll overflow

### Responsive (< 1024px)

- Sidebar collapses to hamburger menu
- Content takes full width
- Top bar remains fixed

---

## Participant Web Layout (Editorial v2)

Mobile-first with progressive enhancement. Mixed auth (public + authenticated). All pages use `max-w-[1280px] mx-auto px-6 lg:px-8` as the default container.

### Home / Discovery (`/`)

```
+------------------------------------------------+
|  SiteHeader (sticky, backdrop-blur)            |
+------------------------------------------------+
|  HERO (navy→navy-2→forest gradient)            |
|  [mono kicker ✦ Teranga · Dakar · Printemps]   |
|  [Fraunces 76px title — italic gold accents]   |
|  [subtitle]                                    |
|  [search pill] [primary CTA] [secondary CTA]   |
|  [4-stat row: events / inscriptions / etc.]    |
|                          [TicketStub -4° tilt] |
+------------------------------------------------+
|  SectionHeader "— À la une cette saison"       |
|  FeaturedTile ×3 (1.1fr / 1fr split)           |
+------------------------------------------------+
|  SectionHeader "— Tous les événements"         |
|  CategoryChip row (no-scrollbar overflow)      |
|  EditorialEventCard grid — sm:2 / lg:3 cols   |
|  "Voir tous les événements" outline pill       |
+------------------------------------------------+
|  NumberedPromiseBand (01 / 02 / 03)            |
+------------------------------------------------+
|  HowItWorks (#comment-ca-marche)               |
+------------------------------------------------+
|  OrganizerCta (navy, gold pill CTA)            |
+------------------------------------------------+
|  Footer (fr-SN · Africa/Dakar · XOF)           |
+------------------------------------------------+
```

- `<h1>` uses `sr-only` for the keyword-rich headline + `aria-hidden` Fraunces display beneath; SEO signal stays intact.
- Hero CTAs: primary `rounded-full bg-teranga-gold px-7 py-3.5` → `/events`; secondary `border-white/20` → `#comment-ca-marche`.

### Event Detail (`/events/[slug]`)

```
+------------------------------------------------+
|  Back bar: "← Tous les événements" | Share    |
+------------------------------------------------+
|  EditorialHero (h-[440px])                     |
|  [pills: category gold / venue ref / urgency]  |
|  [Fraunces 68px title]                         |
|  [tagline]                                     |
+------------------------------------------------+
|  grid-cols-[1fr_380px] gap-14                  |
|  +------ Main ------+  +--- Sticky sidebar ---+|
|  | 4-col meta row   |  | À partir de  Inscrits||
|  | (dividers)       |  | Fraunces 32px price  ||
|  | About + tags     |  | Capacity bar         ||
|  | Programme (day   |  | TicketList (read)    ||
|  |   cards)         |  | Primary pill CTA     ||
|  | Intervenants     |  | Paiement sécurisé··· ||
|  |   (gradient      |  +----------------------+|
|  |   avatars 4up)   |  | Add-to-calendar      ||
|  | Online hint      |  | Feed shortcut        ||
|  +------------------+  +----------------------+|
+------------------------------------------------+
|  SectionHeader "Événements similaires"         |
|  EditorialEventCard grid (4 across)            |
+------------------------------------------------+
```

- Hero cover falls back to `getCoverGradient(event.id).bg` when no image.
- Sidebar is `lg:sticky lg:top-24`. On mobile it stacks below main.
- No tabs — all sections are inlined in the main column.

### Registration Wizard (`/register/[eventId]`)

Container: `max-w-[880px]` on `bg-muted/20`.

```
+------------------------------------------------+
|  Stepper: [← Back]  [1]—[2]—[3]  [Étape N/3]  |
+------------------------------------------------+
|  Step 1 (Billet): ticket card list             |
|  Step 2 (Paiement):                            |
|    grid-cols-[1.3fr_1fr]                       |
|    +--- Main ---+  +--- OrderSummary ---+      |
|    | methods    |  | cover thumb         |     |
|    | promo      |  | Récapitulatif       |     |
|    | Back | Pay |  | line items + total  |     |
|    +-----------+   +---------------------+     |
|  Step 3 (Confirmation):                        |
|    Green check pop + kicker + Fraunces 40px    |
|    TicketPass reveal (.6s slideUp)             |
|    Action pills (Badge / My regs / Browse)     |
+------------------------------------------------+
```

### My Events (`/my-events`)

Container: `max-w-[1120px]`.

```
+------------------------------------------------+
|  Hero row:                                     |
|  ✦ Bonjour {firstName}                         |
|  Vos prochains rendez-vous  [Paramètres][Parc] |
|  "N à venir · M passés"                        |
+------------------------------------------------+
|  TabBar: À venir / Passés / Sauvegardés        |
+------------------------------------------------+
|  Upcoming panel: UpcomingRow list              |
|  Past panel: compact cover-tile grid (3-col)   |
|  Saved panel: dashed empty-state with CTA      |
+------------------------------------------------+
|  Pagination (À venir only, when > 20)          |
+------------------------------------------------+
```

### Badge Page (`/my-events/[id]/badge`)

Container: `max-w-[560px]`, centered.

```
+----------------------------------+
| ← Retour à mes inscriptions      |
| Mon badge                        |
+----------------------------------+
|  TicketPass (rounded-pass)       |
|  [gradient header tint per event]|
|  [Fraunces event title]          |
|  [3-up fields]                   |
|  ───────dashed perforation──────│
|  [QR 210px on white tile]        |
|  [mono code]                     |
|  [holder · ticket]               |
|  [ACCÈS VALIDE gold pill]        |
|  ⚡ Disponible hors-ligne        |
+----------------------------------+
|  [Télécharger le PDF] outline    |
+----------------------------------+
```

---

## Dashboard Layout (Backoffice)

```
+------------------------------------------+
| Stat Card | Stat Card | Stat Card | Stat |
+------------------------------------------+
| Recent Events (table)                    |
|                                          |
+-------------------+----------------------+
| Quick Actions     | Upcoming Events      |
+-------------------+----------------------+
```

- **Stat cards**: 4 across on desktop, 2 on tablet, 1 on mobile
- **Tables**: Full width with horizontal scroll on mobile

---

## Page Width Constraints

| Context | Max Width | Class |
|---------|-----------|-------|
| Backoffice content | None (fluid) | — |
| Participant **editorial** pages (home, detail) | 1280px | `max-w-[1280px] px-6 lg:px-8` |
| Participant My Events dashboard | 1120px | `max-w-[1120px]` |
| Registration wizard | 880px | `max-w-[880px]` (on `bg-muted/20`) |
| Badge page, confirmation states | 560px | `max-w-[560px]` |
| Auth pages (login, register) | 448px | `max-w-md` |

---

## Common Page Structure

Every page follows this pattern:

```tsx
<div>
  {/* Page header */}
  <div className="flex items-center justify-between mb-6">
    <h1 className="text-2xl font-bold text-gray-900">Page Title</h1>
    <PrimaryAction />
  </div>

  {/* Filters (optional) */}
  <div className="flex flex-col sm:flex-row gap-3 mb-6">
    <SearchInput />
    <FilterSelect />
  </div>

  {/* Content */}
  <ContentArea />

  {/* Pagination (optional) */}
  <Pagination />
</div>
```
