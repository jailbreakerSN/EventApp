# Iconography

---

## Icon Library

**Primary**: [Lucide Icons](https://lucide.dev/) — lightweight, consistent, MIT licensed.

- **Web**: `lucide-react` package
- **Flutter**: Equivalent Material Icons (Flutter built-in) or `lucide_icons` package

### Why Lucide

- Consistent 24x24 grid, 2px stroke width
- Tree-shakeable — only import what you use
- Active maintenance, comprehensive set
- Clean, minimal style that matches Inter font

---

## Icon Usage

### Sizes

| Context | Size | Tailwind |
|---------|------|----------|
| Inline with text | 16px | `size={16}` or `h-4 w-4` |
| Navigation items | 17-18px | `size={17}` |
| Buttons with text | 16px | `h-4 w-4` |
| Standalone (card icons) | 20-24px | `size={20}` or `h-5 w-5` |
| Feature icons (dashboard) | 24px | `h-6 w-6` |
| Empty state illustration | 48-64px | `h-12 w-12` to `h-16 w-16` |

### Colors

- **Active navigation**: White (`text-white`)
- **Inactive navigation**: White 60% (`text-white/60`)
- **In buttons**: Inherit from button text color
- **Standalone**: Gray-600 (`text-gray-600`)
- **Muted**: Gray-400 (`text-gray-400`)
- **Status icons**: Match status color (green for success, red for error)

---

## Icon Mapping

### Navigation

| Feature | Icon | Lucide Name |
|---------|------|-------------|
| Dashboard | Grid | `LayoutDashboard` |
| Events | Calendar | `CalendarDays` |
| Participants | People | `Users` |
| Badges/QR | QR Code | `QrCode` |
| Analytics | Chart | `BarChart3` |
| Notifications | Bell | `Bell` |
| Organization | Building | `Building2` |
| Settings | Gear | `Settings` |
| Profile | User | `UserCircle` |

### Actions

| Action | Icon | Lucide Name |
|--------|------|-------------|
| Create/Add | Plus | `Plus` |
| Edit | Pencil | `Pencil` |
| Delete | Trash | `Trash2` |
| Search | Magnifier | `Search` |
| Filter | Funnel | `Filter` |
| Share | Share | `Share2` |
| Download | Download | `Download` |
| Upload | Upload | `Upload` |
| Copy | Clipboard | `Copy` |
| Close | X | `X` |
| Back | Arrow left | `ArrowLeft` |
| Forward | Arrow right | `ArrowRight` |
| Expand | Chevron down | `ChevronDown` |
| Collapse | Chevron up | `ChevronUp` |
| External link | Arrow up-right | `ExternalLink` |
| Logout | Door | `LogOut` |

### Status

| Status | Icon | Lucide Name |
|--------|------|-------------|
| Success | Checkmark | `CheckCircle2` |
| Error | X circle | `XCircle` |
| Warning | Alert | `AlertTriangle` |
| Info | Info | `Info` |
| Pending | Clock | `Clock` |
| Locked | Lock | `Lock` |

### Domain-Specific

| Concept | Icon | Lucide Name |
|---------|------|-------------|
| Event date | Calendar | `Calendar` |
| Location | Map pin | `MapPin` |
| Ticket/Price | Tag | `Tag` |
| Attendees | Users | `Users` |
| QR Scan | Scan | `ScanLine` |
| Badge | ID Card | `CreditCard` |
| Chat/Message | Message | `MessageCircle` |
| Feed/Post | File text | `FileText` |
| Schedule | Clock | `Clock` |
| Speaker | Mic | `Mic` |
| Sponsor | Briefcase | `Briefcase` |
| Money/Payment | Wallet | `Wallet` |
| Check-in | Check | `UserCheck` |

---

## Accessibility for Icons

- **Decorative icons** (next to text labels): Add `aria-hidden="true"`
- **Standalone icons** (no text label): Add `aria-label` with description
- **Icon buttons**: Always have `title` attribute or `aria-label`
- **Never rely on icon alone** to convey meaning — pair with text or tooltip

```tsx
{/* Icon with label — icon is decorative */}
<button>
  <Plus className="h-4 w-4" aria-hidden="true" />
  Creer un evenement
</button>

{/* Icon-only button — needs aria-label */}
<button aria-label="Fermer" title="Fermer">
  <X className="h-4 w-4" />
</button>
```
