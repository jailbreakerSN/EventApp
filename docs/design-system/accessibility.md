# Accessibility Standards

Teranga targets **WCAG 2.1 Level AA** compliance across all web applications.

---

## Color & Contrast

### Rules

- **Normal text** (< 18px): Contrast ratio >= 4.5:1
- **Large text** (>= 18px bold or >= 24px): Contrast ratio >= 3:1
- **UI components** (icons, borders): Contrast ratio >= 3:1
- **Never use color alone** to convey information — always pair with text, icon, or pattern

### Known Issues

- **Gold (#c59e4b) on white** has 3.5:1 contrast — passes AA for large text only, not normal text
- Use gold on navy backgrounds (4.4:1 — passes AA for large text) or as decorative elements
- For gold text on white, use the darker variant `teranga-gold-dark` (#a78336, 4.6:1 — passes AA)

---

## Keyboard Navigation

### Requirements

- All interactive elements must be reachable via Tab key
- Tab order must follow visual reading order (left-to-right, top-to-bottom)
- Escape key closes modals, dropdowns, and popovers
- Enter/Space activates buttons and links
- Arrow keys navigate within groups (tabs, radio buttons, dropdowns)

### Focus Indicators

```css
/* Default focus ring */
:focus-visible {
  outline: 2px solid #1A1A2E;
  outline-offset: 2px;
  border-radius: 4px;
}
```

- Focus ring must be visible on ALL interactive elements
- Use `focus-visible` (not `focus`) to avoid showing rings on mouse clicks
- Never use `outline: none` without providing an alternative focus indicator

---

## Screen Readers

### Semantic HTML

- Use `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>` landmarks
- Use heading hierarchy (`h1` → `h2` → `h3`) — never skip levels
- Use `<button>` for actions, `<a>` for navigation — never `<div onClick>`
- Use `<ul>/<ol>` for lists, `<table>` for tabular data

### ARIA Labels

| Pattern | Implementation |
|---------|----------------|
| Icon-only buttons | `aria-label="Fermer"` |
| Status badges | `aria-label="Statut: Publie"` |
| Loading states | `aria-busy="true"` on container, `aria-label="Chargement..."` |
| Modals | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to title |
| Notifications | `role="alert"` for errors, `role="status"` for success |
| Search results | `aria-live="polite"` on results container |
| Pagination | `aria-label="Pagination"` on nav, `aria-current="page"` on active |

### Announcements

- Form errors: Announce with `role="alert"` so screen readers read immediately
- Page transitions: Announce new page title
- Toast notifications: Use `aria-live="polite"` region
- Loading completion: Announce "Contenu charge" when async data arrives

---

## Forms

### Labels

- Every input MUST have a visible `<label>` with `htmlFor` matching the input `id`
- Placeholder text is NOT a substitute for labels
- Required fields: Add `aria-required="true"` and visible asterisk
- Help text: Link with `aria-describedby` pointing to help text element

### Error Handling

```tsx
<div>
  <label htmlFor="email">Adresse email *</label>
  <input
    id="email"
    type="email"
    aria-required="true"
    aria-invalid={!!error}
    aria-describedby={error ? "email-error" : undefined}
  />
  {error && (
    <p id="email-error" role="alert" className="text-red-500 text-xs mt-1">
      {error}
    </p>
  )}
</div>
```

### Multi-step Forms

- Use `aria-current="step"` on the active step
- Announce step transitions: "Etape 2 sur 3: Billets"
- Preserve form data across steps (never lose input on back navigation)

---

## Touch Targets

### Minimum Sizes

| Element | Minimum Size | Recommended |
|---------|-------------|-------------|
| Buttons | 44 x 44px | 48 x 48px |
| Links in body text | 44px height (with padding) | — |
| Icon buttons | 44 x 44px (pad smaller icons) | 48 x 48px |
| Checkbox/Radio | 24 x 24px (with 44px touch area) | — |
| List items (tappable) | 48px height | 56px |

### Spacing

- Adjacent touch targets must have >= 8px gap
- Navigation items: >= 12px gap between tappable items

---

## Images

### Alt Text

| Image Type | Alt Text |
|-----------|----------|
| Event cover photo | Describe the event visually: "Concert en plein air avec scene eclairee" |
| User avatar | "{User name}'s photo" or empty alt if decorative |
| Decorative icons | `alt=""` (empty) + `aria-hidden="true"` |
| Status icons | Hidden (status communicated via text) |
| QR code | "Code QR pour l'inscription de {name} a {event}" |

---

## Motion & Animation

### Reduced Motion

Respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- Remove parallax effects
- Replace slide animations with fade
- Disable auto-advancing carousels
- Keep essential functional animations (loading spinners)

---

## Testing Checklist

Before each release, verify:

- [ ] Tab through entire page — all interactive elements reachable in logical order
- [ ] Use VoiceOver (macOS) or NVDA (Windows) — all content announced correctly
- [ ] Zoom to 200% — no content clipped or overlapping
- [ ] Test with `prefers-reduced-motion: reduce` — no disorienting animations
- [ ] Run Lighthouse Accessibility audit — score >= 90
- [ ] Verify color contrast with browser DevTools
- [ ] Test with keyboard only (no mouse)
- [ ] Verify all images have appropriate alt text
- [ ] Verify all form inputs have associated labels
