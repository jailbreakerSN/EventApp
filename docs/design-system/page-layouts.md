# Page Layouts

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

## Participant Web Layout

Mobile-first with progressive enhancement. Mixed auth (public + authenticated).

### Public Pages (Event Discovery)

```
+------------------------------------------+
| Header: Logo | Search | Login/Register    |
+------------------------------------------+
|                                          |
|  Hero / Featured Events                  |
|                                          |
|  Event Grid (responsive cards)           |
|  1 col (mobile) → 2 col (md) → 3 col   |
|                                          |
+------------------------------------------+
| Footer: Links | Social | Legal           |
+------------------------------------------+
```

- **Header**: Sticky, white, shadow on scroll, `h-16`
- **Content**: `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`
- **Event grid**: CSS Grid with `gap-6`

### Authenticated Pages (My Events, Registration)

```
+------------------------------------------+
| Header: Logo | ← Back | Avatar           |
+------------------------------------------+
|                                          |
|  Page Content                            |
|  max-w-2xl mx-auto (narrow for forms)   |
|  or max-w-4xl (for lists)               |
|                                          |
+------------------------------------------+
| Bottom Nav (mobile only, < md)           |
+------------------------------------------+
```

### Event Detail Page

```
+------------------------------------------+
| [Cover Image - full width, 40vh max]     |
+------------------------------------------+
| max-w-4xl mx-auto                        |
|                                          |
| Title (h1)            [Share] [Save]     |
| Date | Location | Category              |
|                                          |
| +-----+ +----------------------------+  |
| |Ticket| | Description               |  |
| |Types | | Location map              |  |
| |      | | Organizer info            |  |
| |Price | | Schedule preview          |  |
| |CTA   | |                           |  |
| +-----+ +----------------------------+  |
|  sidebar   main content (md+)           |
+------------------------------------------+
```

- **Mobile**: Single column, ticket types + CTA at bottom (sticky)
- **Desktop (md+)**: Two-column with sticky ticket sidebar

---

## Registration Flow Layout

Narrow, focused, no distractions.

```
+------------------------------------------+
| ← Retour              Step 2/3           |
+------------------------------------------+
| max-w-lg mx-auto                         |
|                                          |
| Step Title (h2)                          |
| Description                              |
|                                          |
| [Form Content]                           |
|                                          |
| [Precedent]            [Suivant →]       |
+------------------------------------------+
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

| Context | Max Width | Tailwind |
|---------|-----------|----------|
| Backoffice content | None (fluid) | — |
| Participant public pages | 1280px | `max-w-7xl` |
| Participant content pages | 1024px | `max-w-4xl` |
| Forms (registration, login) | 512px | `max-w-lg` |
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
