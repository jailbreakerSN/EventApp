# Wave 7: SMS, Email, Communication Channels

**Status:** `not_started`
**Estimated effort:** 1.5 weeks
**Goal:** Multi-channel notifications — push, email, and SMS — critical for the African market where SMS reaches users that push notifications miss.

## Why This Wave Matters

In Senegal and West Africa, many users don't have constant internet access or may not enable push notifications. **SMS is the most reliable channel** for event reminders, ticket confirmations, and emergency communications. Email covers professional/corporate events.

---

## Tasks

### API (Fastify)

#### Notification Preferences
- [ ] User notification preferences endpoint (which channels: push, email, SMS)
- [ ] Per-event notification settings

#### SMS Integration
- [ ] Africa's Talking SMS provider integration
- [ ] SMS template system (registration confirmation, event reminder, check-in receipt)
- [ ] SMS sending service with rate limiting and retry
- [ ] SMS delivery status tracking
- [ ] Phone number validation for Senegalese numbers (+221)

#### Email Integration
- [ ] Email provider integration (SendGrid, Resend, or Firebase Extensions)
- [ ] Email template system (HTML templates with event branding)
- [ ] Registration confirmation email
- [ ] Event reminder email (configurable: 24h, 1h before)
- [ ] Badge attachment in confirmation email

#### Broadcast System
- [ ] Organizer broadcast endpoint (send message to all registrants)
- [ ] Channel selection per broadcast (push + SMS + email)
- [ ] Broadcast scheduling (send at specific time)
- [ ] Broadcast analytics (delivered, opened, failed by channel)

### Cloud Functions

- [ ] `onRegistrationCreated` → send confirmation via preferred channels
- [ ] Scheduled reminder function (24h and 1h before event)
- [ ] `onBroadcastCreated` → fan-out to all channels
- [ ] SMS delivery webhook handler
- [ ] Email bounce/complaint handler

### Web Backoffice

- [ ] Broadcast composer (message + channel selection + scheduling)
- [ ] Broadcast history with delivery stats
- [ ] SMS/Email template editor
- [ ] Notification analytics dashboard

### Web Participant App

- [ ] Notification preferences page
- [ ] Web Push notification opt-in and handling
- [ ] Notification center (in-app notification list page)

### Mobile (Flutter) — DEFERRED TO WAVE 9

> Deferred: Push notification handling (foreground/background/terminated), notification center, deep linking from notifications.

### Shared Types

- [ ] Notification preference schemas
- [ ] Broadcast schemas (create, status, analytics)
- [ ] SMS/Email template schemas
- [ ] Notification channel enum (`push`, `sms`, `email`)

---

## Exit Criteria

- [ ] SMS confirmation sent on registration (for users with phone numbers)
- [ ] Email confirmation sent with badge PDF attached
- [ ] Event reminders sent via configured channels
- [ ] Organizer can broadcast to all registrants via push + SMS + email
- [ ] Users can configure their notification preferences
- [ ] SMS delivery to Senegalese numbers (+221) works reliably
- [ ] Notification center shows all notifications in-app

## Dependencies

- Wave 1 completed (registrations exist)
- Africa's Talking API account and credits
- Email service provider account (SendGrid/Resend)
- FCM already configured (from Wave 5)

## Deploys After This Wave

- API: SMS, email, broadcast, notification preferences endpoints
- Web: Broadcast composer, notification analytics
- Mobile: Deferred to Wave 9
- Functions: Multi-channel notification triggers

## Technical Notes

- **Africa's Talking** is the recommended SMS provider for West Africa — good coverage in Senegal
- **SMS costs money** — implement rate limiting and allow organizers to opt-in per event
- **Phone number format**: Senegal uses +221 XX XXX XX XX (9 digits after country code)
- **SMS templates** should be short (<160 chars for single SMS) and in French by default
- **Email bounce handling**: Automatically disable email for addresses that hard-bounce
- **Notification deduplication**: If a user gets push + SMS + email for the same event, coordinate timing to avoid feeling spammy
