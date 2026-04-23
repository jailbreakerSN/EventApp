# PWA icons

Expected files (generate from the brand SVG via the existing
`scripts/generate-logo-assets.mjs` pipeline when available):

- `pwa-192.png` — 192×192, any purpose
- `pwa-512.png` — 512×512, any purpose
- `pwa-maskable-512.png` — 512×512, maskable (80% safe area; see
  https://web.dev/maskable-icon/)
- `apple-touch-icon.png` — 180×180, iOS Safari home-screen icon

Until these ship, `manifest.webmanifest` references them; the iOS / Android
install prompts degrade to a generic icon but the flow still works.

Legacy icons at the app root (`/icon-192.png`, `/icon-512.png`,
`/apple-icon.png`) remain available as a fallback for the older
`manifest.json` — the new `manifest.webmanifest` references the
`/icons/` path exclusively so the PWA install experience stays on
purpose-specific assets once they ship.
