# Brand Identity

> **Editorial v2 (2026-04-17)** — the participant web app now runs on the editorial Teranga Participant design. The brand stays identical; the expression shifts toward magazine-style editorial, which this doc records.

## Name

**Teranga** — from the Wolof word meaning *hospitality*, *generosity*, and *welcoming*. It embodies the cultural foundation of every gathering in Senegal and West Africa.

### Name Usage Rules

- Always capitalize: **Teranga**, never "teranga" or "TERANGA".
- **Brand signature line (displayed)**: *"L'événementiel africain, **connecté** et **mémorable**."* — the two italic words render in `teranga-gold-light` Fraunces italic on dark, gold-dark Fraunces italic on light. Used in the homepage hero and marketing collateral.
- **Product names**: **Teranga** (the platform), **Teranga Back-office** (organizer dashboard), **Teranga App** (mobile).
- **Locale line (mono)**: `fr-SN · Africa/Dakar · XOF` — used in footers and page metadata, rendered in JetBrainsMono at `text-[11px]`, `tracking-[0.1em]`.
- **Code prefix**: registration codes start with `TER-` (e.g. `TER-DTS26-4F2A1C`). Numbered identifiers in the editorial UI use `TER · 001/008` style (mono overline on cover tiles).

## Logo

- **Wordmark**: "Teranga" in **Fraunces** semibold (switched from Inter Bold for the editorial look). Navy (`#1A1A2E`) on light, gold-whisper (`#faf6ee`) on dark.
- **Dot mark**: 10px gold circle with a 4px gold/22% glow sits to the left of the wordmark; the subtitle ("Events" / "Back-office") sits to the right, JetBrainsMono 10px uppercase, separated by a 1px gold border.
- **Minimum size**: 120px wide (web), 32dp (mobile).
- **Clear space**: Minimum 1× the height of the "T" on all sides.

## Tone of Voice

| Context | Tone | Example |
|---------|------|---------|
| UI labels & buttons | Clear, concise, action-oriented | "Explorer", "S'inscrire à l'événement" |
| Editorial headlines | Magazine voice, slightly poetic | "Trois événements qu'on ne manquerait pour rien au monde" |
| Mono kickers | Detached, datelined | "✦ Teranga · Dakar · Printemps 2026" |
| Error messages | Helpful, not blaming | "Email ou mot de passe incorrect." (not "Erreur !") |
| Empty states | Encouraging, guiding | "Aucun événement sauvegardé. Cliquez sur l'icône signet…" |
| Success feedback | Warm, celebratory | "Votre place est réservée. À très bientôt." |
| Marketing | Aspirational, community-focused | "L'événementiel africain, *connecté* et *mémorable*." |

### Editorial voice rules

- Kickers use a `✦` or `—` glyph prefix (`"✦ Bonjour Aïssatou"`, `"— À la une cette saison"`).
- Hero headlines use Fraunces italic for emphasis words, never bold.
- Scarcity copy is matter-of-fact: `"Plus que 58 places"` — no exclamation marks, no countdown drama.
- Offline confidence: `"⚡ Disponible hors-ligne"` is the canonical microcopy for any feature that works without network.
- Numbered lists in editorial bands use `01` / `02` / `03` mono numerals, not words.

### Language Conventions

- **Default language**: French (fr)
- **Formal "vous"**: Always use "vous" (formal), never "tu" in the UI
- **Dates**: `dd MMMM yyyy` format (e.g., "06 avril 2026"), using `Africa/Dakar` timezone
- **Currency**: XOF formatted as `5 000 FCFA` (space as thousands separator, FCFA suffix)
- **Numbers**: French convention — space as thousands separator, comma for decimals

## Brand Values

1. **Hospitalite** (Hospitality) — every interaction should feel welcoming
2. **Fiabilite** (Reliability) — the platform works even when the network doesn't
3. **Simplicite** (Simplicity) — powerful features, simple interfaces
4. **Communaute** (Community) — events bring people together; our platform enables that
5. **Innovation** — modern technology adapted to African realities (offline-first, mobile money)

## Target Audiences

| Audience | Key Need | Design Priority |
|----------|----------|-----------------|
| **Organizers** | Efficiency, control, analytics | Dense information, powerful tools, desktop-optimized |
| **Participants** | Discovery, ease, social | Visual, mobile-first, fast, shareable |
| **Staff** | Speed, reliability | Large touch targets, offline-capable, minimal UI |
| **Speakers** | Self-service, visibility | Profile management, schedule view |
| **Sponsors** | Lead collection, ROI | Scanner, analytics, lead export |
