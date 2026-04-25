# `apps/mobile` — Teranga Flutter App

Teranga's iOS + Android mobile app. **Wave 9** in the delivery roadmap — currently scaffolded, full feature parity scheduled post-web validation.

> **Canonical reference:** [`docs-v2/40-clients/mobile-flutter.md`](../../docs-v2/40-clients/mobile-flutter.md).
> **Status:** Planned. Web-first MVP strategy means the mobile app rides behind the web platform's product validation.

## Tech

- **Flutter 3** stable channel (>= 3.27).
- **Riverpod 2** for state management with code generation (`@riverpod` annotations).
- **go_router** for typed navigation.
- **Hive** for offline-critical local storage (QR data, check-in queue).
- **Firestore SDK** for real-time streams (feed, messaging) with offline persistence.
- **Firebase Auth** for sign-in (email/password, Google).
- **FCM** for push notifications.
- **mobile_scanner** for QR scanning (offline-first staff check-in).

## Why mobile is offline-first

The platform's **core differentiator** is reliable QR badge scanning at events held in venues with intermittent connectivity (a fact of life across West Africa). The mobile app:

- Caches the day's registrations locally (Hive) before going offline.
- Validates QR signatures locally using the cached HMAC secret-derived key.
- Queues check-in writes for sync when connectivity returns.
- Resolves conflicts deterministically on reconnect (last-write-wins on `checkinAt`).

See [`docs-v2/20-architecture/concepts/qr-v4-and-offline-sync.md`](../../docs-v2/20-architecture/concepts/qr-v4-and-offline-sync.md) and the relevant ADRs ([0003 QR v4 HKDF](../../docs-v2/20-architecture/decisions/0003-qr-v4-hkdf-design.md), [0004 ECDH X25519](../../docs-v2/20-architecture/decisions/0004-offline-sync-ecdh-encryption.md)).

## Local dev

```bash
cd apps/mobile

# 1. Generate Firebase options (one-time)
flutterfire configure --project=teranga-events-dev

# 2. Get dependencies
flutter pub get

# 3. Run code generation (Riverpod, Freezed)
flutter pub run build_runner build --delete-conflicting-outputs

# 4. Run on a connected device or emulator
flutter run
```

WSL2 caveat: the Android emulator must be launched on the Windows host. Use `10.0.2.2` instead of `localhost` to reach the host machine.

## Folder structure (feature-first)

```
lib/
├── core/             # Shared services (auth, firestore, datetime, i18n)
├── features/
│   ├── events/       # Event discovery, detail, registration
│   │   ├── presentation/{pages,widgets}/
│   │   ├── providers/        # Riverpod
│   │   └── data/             # Repositories, models
│   ├── checkin/      # Offline-first staff scanning
│   ├── feed/
│   └── messaging/
└── l10n/             # ARB files (fr, en, wo)
```

## Status

The mobile app is intentionally deferred to **Wave 9** (3-4 weeks). Wave 1-8 ship the API + web platform; Wave 9 brings full Flutter parity and adds the offline check-in differentiator.

## Deployment

- Android: `flutter build apk --release` → distribute via Play Store.
- iOS: `flutter build ios --release` (macOS required) → TestFlight then App Store.
