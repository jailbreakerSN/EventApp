# Wave 5: Feed, Messaging, Sessions

**Status:** `completed`
**Estimated effort:** 2 weeks
**Goal:** Add social and scheduling features — event feed, direct messaging, and session/agenda management.

## Why This Wave Matters

Events are social. Participants want to see updates, message each other, and plan which sessions to attend. This wave transforms Teranga from a ticketing tool into an event experience platform.

---

## Tasks

### API (Fastify)

#### Event Feed
- [x] Create feed post endpoint (text, image, poll)
- [x] List feed posts with pagination (by event)
- [x] Like/react to feed post
- [x] Comment on feed post
- [x] Delete/hide feed post (organizer moderation)
- [x] Pin post to top of feed

#### Messaging
- [x] Create conversation (1-to-1 or group)
- [x] Send message endpoint
- [x] List conversations for user
- [x] List messages in conversation with pagination
- [x] Mark conversation as read
- [x] Message moderation tools for organizers

#### Sessions/Agenda
- [x] Session CRUD endpoints (within event)
- [x] Session schedule: list sessions by day/time
- [x] Session speaker assignment
- [x] Session room/location assignment
- [x] Participant session bookmarking (add to personal agenda)
- [x] Session capacity and RSVP (optional per session)

### Cloud Functions

- [x] `onFeedPostCreated` → push notification to event participants
- [x] `onMessageSent` → push notification to recipient(s)
- [x] `onSessionUpdated` → notify bookmarked participants of schedule changes

### Web Backoffice

- [x] Feed management page (create post, moderate, pin)
- [x] Session/agenda builder (drag-and-drop schedule, room assignment)
- [x] Session speaker assignment UI
- [x] Message moderation dashboard

### Web Participant App

- [x] Event feed page (`/events/[eventId]/feed`) — post list, create post, comments
- [x] Session schedule page (`/events/[eventId]/schedule`) — daily timeline, session detail, bookmarks
- [x] Messaging page (`/messages`) — conversation list, chat screen
- [x] Push notification opt-in via Web Push API

### Mobile (Flutter) — DEFERRED TO WAVE 9

> Deferred: Feed screen (real-time Firestore streams, post creation, likes, comments), messaging screen (conversation list, chat, image sending, typing indicators), session/agenda screen (daily timeline, bookmarks, personal agenda).

### Shared Types

- [x] Feed post schemas (create, response, with reactions)
- [x] Message and conversation schemas
- [x] Session schemas (CRUD, schedule query)
- [x] Bookmark/RSVP schemas

---

## Exit Criteria

- [x] Organizer can create feed posts; participants see them in real-time
- [x] Participants can message each other within an event
- [x] Organizer can build a session schedule with speakers and rooms
- [x] Participants can browse the agenda and bookmark sessions
- [x] Push notifications work for feed posts and messages
- [x] All new endpoints tested

## Dependencies

- Wave 1 completed (events and registrations exist)
- FCM configured for push notifications
- Cloud Storage for image uploads in feed/messages

## Deploys After This Wave

- API: Feed, messaging, session endpoints
- Web: Feed management, agenda builder, message moderation
- Mobile: Deferred to Wave 9
- Functions: Notification triggers

## Technical Notes

- **Firestore real-time**: Feed and messaging use Firestore snapshots on mobile for real-time updates
- **Pagination**: Feed uses cursor-based pagination (createdAt descending)
- **Image uploads**: Use signed upload URLs from Cloud Storage, store URL in document
- **Message encryption**: Not in scope for MVP — evaluate post-launch
