# UX Guidelines

---

## Event Discovery (Participant Web)

### Search & Filter

- **Search bar**: Prominent, top of page, with placeholder "Rechercher un evenement..."
- **Category chips**: Horizontal scroll of category filters (Conferences, Ateliers, Concerts, etc.)
- **Active filter indicator**: Gold highlight on active chip, count badge
- **Clear all**: One-click to reset all filters
- **Results count**: Show "42 evenements trouves" above results
- **No results**: Friendly empty state with suggestions ("Essayez d'elargir vos criteres")

### Event Listing

- **Default sort**: Upcoming first (by startDate ascending)
- **Card grid**: Visual, image-forward cards
- **Key info visible without clicking**: Title, date, location, price, category
- **Social proof**: Show registration count ("127 inscrits") when > 10
- **Urgency signals**: "Derniers billets!" when > 80% capacity, "Bientot complet"
- **Infinite scroll** on mobile, **pagination** on desktop

### Event Detail

- **Hero image**: Full-width cover, 40vh max height
- **Above the fold**: Title, date, location, price, and register CTA must be visible without scrolling on mobile
- **Sticky CTA**: On mobile, register button sticks to bottom of screen
- **Share button**: Generate WhatsApp share link with event title + URL (WhatsApp is primary sharing channel in Senegal)
- **Organizer trust**: Show organizer name, logo, and past event count
- **Structured data**: schema.org/Event JSON-LD for Google rich results

---

## Registration Flow

### Principles

1. **Minimize steps**: 2-3 steps maximum for free events, 3-4 for paid
2. **No account required to browse**: Registration requires auth, but discovery is public
3. **Smart redirect**: After login/register, redirect back to the event they were viewing
4. **Progress indicator**: Show "Etape 2 sur 3" with visual step bar
5. **Confirmation = celebration**: Success screen with confetti-like visual, QR code, and "Ajouter au calendrier" option

### Free Event Flow

```
Event Detail → [S'inscrire] → Select Ticket Type → Confirm → Success + QR Badge
                                (skip if only 1 type)
```

### Paid Event Flow

```
Event Detail → [S'inscrire] → Select Ticket → Payment Method → Payment → Success + QR Badge
```

### Post-Registration

- Show QR badge immediately
- "Ajouter a Google Calendar" link
- "Partager avec un ami" (WhatsApp share)
- Email confirmation (if email notification enabled)

---

## Dashboard (Organizer Backoffice)

### Key Metrics (Above the Fold)

4 stat cards showing:
1. **Total evenements** (with trend vs last month)
2. **Inscriptions** (total across events)
3. **Check-ins** (total across events)
4. **Revenus** (if payments enabled, in FCFA)

### Quick Actions

Prominent buttons for the most common tasks:
- "Creer un evenement"
- "Voir les inscriptions"
- "Scanner les badges" (links to mobile scanner instructions until Wave 9)

### Recent Activity

- Last 5 events with status, registration count, next date
- Last 5 registrations with participant name, event, status

---

## Form UX

### Validation

- **Real-time validation**: Validate on blur (not on every keystroke)
- **Error messages**: Specific and actionable ("L'adresse email n'est pas valide" not "Champ invalide")
- **Error summary**: For multi-step forms, show summary at top of step with links to errored fields
- **Success feedback**: Brief green toast on successful save

### Date/Time Inputs

- **Date format**: `JJ/MM/AAAA` (French convention)
- **Timezone**: Always `Africa/Dakar` (UTC+0), display explicitly
- **Date picker**: Native browser date input (better mobile UX than custom pickers)
- **Time picker**: Native time input with 24h format

### Price/Currency Inputs

- **Format**: Integer only (XOF has no decimals)
- **Display**: `5 000 FCFA` (space separator, FCFA suffix)
- **Input**: Numeric keyboard on mobile, strip non-digits

---

## Performance UX (African Network Optimization)

### Image Handling

- **Lazy loading**: All images below the fold use `loading="lazy"`
- **Progressive loading**: Low-quality placeholder → full image (blur-up)
- **Responsive images**: Use `next/image` with `sizes` attribute
- **Max file size**: Event covers max 500KB after optimization
- **Formats**: WebP preferred, JPEG fallback

### Skeleton Loading

- Show skeleton UI immediately, don't show blank page
- Match the shape of actual content (cards, text lines, avatars)
- Use `animate-pulse` with gray background

### Offline Handling

- Show cached content if available (service worker)
- Display "Hors ligne" banner when disconnected
- Queue form submissions for retry when online
- Never show blank error page — always show last known state

### Bundle Size Budget

- **First load JS**: < 100KB gzipped (participant web)
- **Route chunks**: < 50KB each
- **Images per page**: < 500KB total (use responsive sizing)
- **Time to interactive**: < 3s on 3G

---

## Internationalization (i18n)

### Current Languages

| Code | Language | Status |
|------|----------|--------|
| `fr` | French | Default, fully supported |
| `en` | English | Planned |
| `wo` | Wolof | Future (post-launch) |

### Conventions

- **Date format**: `dd MMMM yyyy` in French ("06 avril 2026")
- **Currency**: `5 000 FCFA` — use `Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" })`
- **Timezone display**: "Heure de Dakar (UTC+0)"
- **Phone numbers**: `+221 XX XXX XX XX` (Senegalese format)
- **Pluralization**: French rules (0 = singular in some contexts, 1 = singular, 2+ = plural)

### UI String Guidelines

- Keep button labels to 2-3 words max
- Use infinitive form for actions: "Creer", "Modifier", "Supprimer"
- Use sentence case, not title case (French convention)
- Avoid abbreviations — spell out fully

---

## WhatsApp Sharing

WhatsApp is the dominant communication channel in Senegal. Optimize for it:

### Open Graph Tags (Event Detail Pages)

```html
<meta property="og:type" content="website" />
<meta property="og:title" content="Concert Youssou N'Dour — Teranga" />
<meta property="og:description" content="Le 15 mars 2027 a Dakar. Billets a partir de 5 000 FCFA." />
<meta property="og:image" content="https://teranga.sn/events/concert-youssou/cover.jpg" />
<meta property="og:url" content="https://teranga.sn/events/concert-youssou-ndour-a3f2c1" />
```

### Share Button Behavior

```
"Partager sur WhatsApp" → opens:
whatsapp://send?text=Concert Youssou N'Dour — 15 mars 2027 a Dakar. Inscrivez-vous : https://teranga.sn/events/concert-youssou-ndour-a3f2c1
```

---

## Accessibility Quick Reference

| Element | Requirement |
|---------|-------------|
| Touch targets | Minimum 44x44px (48x48px preferred) |
| Color contrast | 4.5:1 for text, 3:1 for large text/icons |
| Focus indicators | Visible 2px ring on all interactive elements |
| Form labels | Always visible (not placeholder-only) |
| Error announcements | `role="alert"` on error messages |
| Image alt text | Descriptive for event images, empty for decorative |
| Skip navigation | "Aller au contenu" link at top of page |
| Reduced motion | Respect `prefers-reduced-motion` media query |

See [accessibility.md](accessibility.md) for detailed WCAG compliance guide.
