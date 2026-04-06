# Wave 5: Feed, Messaging, Sessions

**Status:** `not_started`
**Estimated effort:** 2 weeks
**Goal:** Add social and scheduling features — event feed, direct messaging, and session/agenda management.

## Why This Wave Matters

Events are social. Participants want to see updates, message each other, and plan which sessions to attend. This wave transforms Teranga from a ticketing tool into an event experience platform.

---

## Tasks

### API (Fastify)

#### Event Feed
- [ ] Create feed post endpoint (text, image, poll)
- [ ] List feed posts with pagination (by event)
- [ ] Like/react to feed post
- [ ] Comment on feed post
- [ ] Delete/hide feed post (organizer moderation)
- [ ] Pin post to top of feed

#### Messaging
- [ ] Create conversation (1-to-1 or group)
- [ ] Send message endpoint
- [ ] List conversations for user
- [ ] List messages in conversation with pagination
- [ ] Mark conversation as read
- [ ] Message moderation tools for organizers

#### Sessions/Agenda
- [ ] Session CRUD endpoints (within event)
- [ ] Session schedule: list sessions by day/time
- [ ] Session speaker assignment
- [ ] Session room/location assignment
- [ ] Participant session bookmarking (add to personal agenda)
- [ ] Session capacity and RSVP (optional per session)

### Cloud Functions

- [ ] `onFeedPostCreated` → push notification to event participants
- [ ] `onMessageSent` → push notification to recipient(s)
- [ ] `onSessionUpdated` → notify bookmarked participants of schedule changes

### Web Backoffice

- [ ] Feed management page (create post, moderate, pin)
- [ ] Session/agenda builder (drag-and-drop schedule, room assignment)
- [ ] Session speaker assignment UI
- [ ] Message moderation dashboard

### Web Participant App

- [ ] Event feed page (`/events/[eventId]/feed`) — post list, create post, comments
- [ ] Session schedule page (`/events/[eventId]/schedule`) — daily timeline, session detail, bookmarks
- [ ] Messaging page (`/messages`) — conversation list, chat screen
- [ ] Push notification opt-in via Web Push API

### Mobile (Flutter) — DEFERRED TO WAVE 9

> Deferred: Feed screen (real-time Firestore streams, post creation, likes, comments), messaging screen (conversation list, chat, image sending, typing indicators), session/agenda screen (daily timeline, bookmarks, personal agenda).

### Shared Types

- [ ] Feed post schemas (create, response, with reactions)
- [ ] Message and conversation schemas
- [ ] Session schemas (CRUD, schedule query)
- [ ] Bookmark/RSVP schemas

---

## Exit Criteria

- [ ] Organizer can create feed posts; participants see them in real-time
- [ ] Participants can message each other within an event
- [ ] Organizer can build a session schedule with speakers and rooms
- [ ] Participants can browse the agenda and bookmark sessions
- [ ] Push notifications work for feed posts and messages
- [ ] All new endpoints tested

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
