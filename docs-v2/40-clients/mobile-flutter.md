---
title: Mobile App (Flutter)
status: planned
last_updated: 2026-04-25
---

# Mobile App (Flutter)

> **Status: ~30% shipped** — Auth and event discovery are wired. Registration, badge, scanner, feed, and profile are page shells with providers not fully connected.

App: `apps/mobile/`  
Tech: Flutter 3.27+ (stable), Dart, Riverpod 2.6, go_router, Hive, mobile_scanner v6, Firebase suite

---

## Overview

The Flutter app serves two personas:

1. **Participants** — browse events, register, view QR badge, follow feed
2. **Staff** — scan participant QR codes at the venue (online + offline)

The app is designed for **iOS and Android**. Tablet-optimized layouts are deferred to Wave 9.

---

## Feature modules

```
apps/mobile/lib/features/
├── auth/           — Login + register (Firebase Auth)
├── events/         — Event discovery + detail
├── registration/   — Event registration flow (stub)
├── badge/          — Digital badge + QR display (stub)
├── scanner/        — Staff QR scanner (stub)
├── feed/           — Event live feed (stub)
├── networking/     — 1:1 networking (planned)
└── profile/        — User profile (stub)
```

### Auth ✅ shipped

- `LoginPage` — email/password form, validation, Firebase sign-in, error handling
- `RegisterPage` — account creation
- `authNotifierProvider` — `AsyncNotifier` listening to `firebase_auth.authStateChanges()`

### Events ✅ shipped (discovery)

- `EventsListPage` — category chips (Tous / Conf / Workshop / Concert / Festival / Sport / Networking), search bar, RefreshIndicator, event cards
- `EventDetailPage` — event detail with date, location, description, register CTA
- `eventsListProvider` — fetches from `apiClientProvider.searchEvents()`
- `eventFilterProvider` — `StateProvider` for query/category/pagination

### Registration ⚠ partial (provider exists, no UI page)

- `registrationProvider` exists
- No dedicated registration page — wiring pending (Wave 9)

### Badge 🔲 stub

- `MyBadgePage` shell exists
- No data binding or QR code rendering yet

### Scanner 🔲 stub

- `ScannerPage` shell exists
- `mobile_scanner v6.0.2` is in pubspec.yaml — camera integration pending
- Full offline sync + ECDH decryption: Wave 9

### Feed 🔲 stub

- `FeedPage` scaffold — no API integration

### Networking 📅 planned

- `NetworkingPage` shows "Bientôt disponible" placeholder
- 1:1 meeting scheduling: deferred to post-Wave 9

### Profile 🔲 stub

- `ProfilePage` scaffold — no data binding

---

## State management

The app uses **Riverpod 2** with code generation:

```dart
// Example: events list provider
@riverpod
Future<List<Event>> eventsList(EventsListRef ref) async {
  final api = ref.watch(apiClientProvider);
  final filter = ref.watch(eventFilterProvider);
  return api.searchEvents(query: filter.query, category: filter.category);
}
```

Key providers:

| Provider | Type | Purpose |
|---|---|---|
| `authNotifierProvider` | `AsyncNotifier<User?>` | Firebase Auth state |
| `eventsListProvider` | `FutureProvider<List<Event>>` | Event discovery |
| `eventDetailProvider(id)` | `FutureProvider<Event>` | Single event |
| `eventFilterProvider` | `StateProvider<EventFilter>` | Search/filter state |
| `apiClientProvider` | `Provider<ApiClient>` | HTTP client singleton |

---

## Navigation

go_router with typed routes:

| Route | Screen |
|---|---|
| `/auth/login` | LoginPage |
| `/auth/register` | RegisterPage |
| `/events` | EventsListPage |
| `/events/:id` | EventDetailPage |
| `/badge` | MyBadgePage |
| `/scanner` | ScannerPage |
| `/feed` | FeedPage |
| `/networking` | NetworkingPage |
| `/profile` | ProfilePage |

---

## Firebase configuration

```bash
# Configure Firebase for local emulators
cd apps/mobile
flutterfire configure --project=teranga-app-990a8

# Or use existing GoogleServices files if already generated
```

For emulator mode, set `USE_EMULATOR=true` in the Firebase initialization code:

```dart
// lib/core/config.dart or via --dart-define
const bool useEmulator = bool.fromEnvironment('USE_EMULATOR', defaultValue: false);
```

---

## Offline capability (current state)

- Hive is in pubspec as a dependency — local storage setup but no explicit sync queue implemented yet
- Events list is cached after first fetch (Riverpod keeps the `FutureProvider` alive in memory)
- Full offline sync (ECDH-encrypted snapshot + local QR validation + offline queue) is Wave 9

---

## Development

```bash
# Install Flutter dependencies
cd apps/mobile && flutter pub get

# Generate code (Riverpod + Freezed)
flutter pub run build_runner build --delete-conflicting-outputs

# Run on connected device or emulator
flutter run

# Run tests
flutter test
```

**After adding/changing Riverpod providers or Freezed models**, always run:
```bash
flutter pub run build_runner build --delete-conflicting-outputs
```
