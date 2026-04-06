# Wave 9: Mobile App Completion

**Status:** `not_started`
**Estimated effort:** 3-4 weeks
**Goal:** Complete the Flutter mobile app with all features deferred from Waves 2-8, including the core differentiator: offline QR check-in.

## Why This Wave Matters

The mobile app is Teranga's **competitive moat**. The offline-first QR scanner is the feature no web app can replicate. By building the full web platform first (Waves 2-8), we validated the product with real users and organizers. Now we bring that proven experience to native mobile — with push notifications, camera-based QR scanning, and true offline-first capabilities.

The Flutter mobile app already has a foundation from Wave 1 (event discovery, registration, badge view). This wave completes it with all features that the web platform delivers, plus mobile-exclusive capabilities.

---

## Tasks

### Offline QR Check-in (Core Differentiator — from Wave 2)

- [ ] QR scanner screen using device camera (`mobile_scanner` package)
- [ ] Offline registration cache using Hive
  - [ ] Pre-event sync: download all registrations for assigned event
  - [ ] Store QR → registration mapping locally
  - [ ] Periodic background sync when online
- [ ] Offline check-in queue
  - [ ] Scan → validate against local cache → mark checked-in locally
  - [ ] Queue check-in records in Hive when offline
  - [ ] Auto-sync queue when connectivity returns
  - [ ] Visual indicator: online/offline status, pending sync count
- [ ] Check-in result screen (participant name, ticket type, access zone, photo)
- [ ] Duplicate scan detection (show "already checked in" with timestamp)
- [ ] Manual check-in search (find by name/email when QR fails)
- [ ] Check-in statistics dashboard (scanned/total, by zone)

### Social Features (from Wave 5)

- [ ] Event feed screen (real-time updates via Firestore streams)
  - [ ] Post creation (text + image upload)
  - [ ] Like/react animation
  - [ ] Comment thread
  - [ ] Pull-to-refresh + infinite scroll
- [ ] Messaging screen
  - [ ] Conversation list with unread count
  - [ ] Chat screen with real-time messages (Firestore stream)
  - [ ] Image sending in chat
- [ ] Session/agenda screen
  - [ ] Daily schedule view (timeline)
  - [ ] Session detail (description, speaker bio, room)
  - [ ] Bookmark/save session to personal agenda
  - [ ] Personal agenda view (only bookmarked sessions)

### Payments (from Wave 6)

- [ ] Payment flow during registration
  - [ ] Ticket price display and payment method selection
  - [ ] Redirect to payment provider (Wave, Orange Money)
  - [ ] Payment confirmation screen
  - [ ] Payment failure/retry flow
- [ ] Payment history in user profile
- [ ] Receipt download

### Communications (from Wave 7)

- [ ] Push notification handling (foreground, background, terminated)
- [ ] Notification preferences screen
- [ ] Notification center (in-app notification list)
- [ ] Deep linking from notifications to relevant screens

### Organizer Tools (from Wave 4)

- [ ] Organization switcher (for users in multiple orgs)
- [ ] Basic event management for organizers (edit, publish/unpublish from mobile)

### Speaker & Sponsor (from Wave 8)

- [ ] Speaker profile screen (view for participants)
- [ ] Sponsor booth screen and directory
- [ ] Sponsor lead scanner (QR-based badge scanning for lead collection)
- [ ] Lead list and notes for sponsors

### Platform Polish

- [ ] Offline-first event caching (Hive + Firestore offline persistence)
- [ ] Pull-to-refresh across all list screens
- [ ] Error states and retry UI for all data-fetching screens
- [ ] App icon and splash screen with Teranga branding
- [ ] Localization: French (default), English, Wolof

---

## Exit Criteria

- [ ] Staff can scan QR codes and check in participants while completely offline
- [ ] Offline check-ins sync automatically when connectivity returns
- [ ] Participant can discover events, register, pay, and view badge on mobile
- [ ] Feed, messaging, and session agenda work with real-time updates
- [ ] Push notifications arrive for registrations, messages, event updates
- [ ] Sponsor lead scanner works offline
- [ ] End-to-end test: go offline → scan 10 badges → come online → verify all synced
- [ ] App builds successfully for Android and iOS

## Dependencies

- Waves 2-8 completed (all API endpoints and web features exist and are validated)
- FCM configured for push notifications
- Payment providers integrated (from Wave 6)

## Deploys After This Wave

- Android APK/AAB for Google Play Store submission
- iOS build for App Store submission (requires macOS)
- Firebase App Distribution for beta testing

## Technical Notes

- **Flutter already has Wave 1 foundation**: Event discovery, registration, badge view — update to use latest API contracts
- **Hive** for offline storage — registration cache, check-in queue, event data
- **Firestore offline persistence** is enabled by default in Flutter — real-time streams work offline for cached data
- **mobile_scanner** package already in pubspec.yaml from Wave 1 setup
- **Riverpod** providers exist for events, registrations — extend for new features
- **Battery optimization**: Scanner screen should minimize background work, keep camera active efficiently
- **Offline-first mindset**: Every screen should handle no-connectivity gracefully with cached data and queued writes
