# Agenda Publish / Notify Workflow — Design

**Status:** proposal · 2026-04-19
**Owner:** API + Web team
**Context:** Follow-up to the Wave 5 session feature and the staging findings
of 2026-04-19 (403 on `/sessions-bookmarks`, empty `Programme à venir` on the
public event detail page, and drifted registration snapshots).

---

## 1. Problem statement

Today the Teranga agenda has three gaps that together make it feel half-built
from a participant's point of view:

1. **No draft/publish distinction on sessions.** Any session an organizer
   creates is immediately visible to anyone who can view the event. There is
   no way to build the programme progressively behind the scenes and reveal
   it in one swoop.
2. **No proactive notification.** Participants must open the event to see new
   sessions. They are never told "the programme is now available" or
   "session X moved to 10h instead of 9h."
3. **Unreliable read path.** The `/v1/events/:eventId/sessions` endpoint was
   authenticated until this PR, so the SSR-rendered public event page ran
   it anonymously and got `401`, rendering the empty-state fallback even
   when sessions existed (this is what "Programme à venir" was covering
   for on `dakar-tech-summit-2026`).

The PR that accompanies this document fixes #3 (public read for published
events). This doc proposes the workflow for #1 and #2.

---

## 2. Design principles

- **One source of truth.** The session document owns its publish state. No
  separate "published agenda" mirror document — the existing `sessions`
  collection stays authoritative and we only add a status field.
- **Explicit publish is a single action.** Organizers draft freely, then
  press "Publier l'agenda" once. The action is event-scoped, not
  session-by-session, because that matches how organizers actually work in
  the field — they build the whole day then release it.
- **Per-session overrides remain possible.** An organizer can still
  edit/reorder/cancel a session after publish; those are handled by the
  session.updated / session.deleted events that already exist, and trigger
  per-session notifications (not a full re-publish).
- **Server-side fan-out.** Notifications and denormalized snapshots are
  maintained by domain-event listeners, never by the client. Same pattern
  we just added for `event.updated` → registration fan-out.
- **Offline-first reads.** The participant Flutter app caches the last-known
  agenda and refreshes on demand. FCM pushes carry the eventId so the app
  can invalidate its local cache without a round-trip.

---

## 3. Data-model changes

### 3.1 `Session` schema (`packages/shared-types/src/event.types.ts`)

Add two fields:

```ts
export const SessionSchema = z.object({
  // ... existing fields
  /**
   * Draft state lives client-side only on the organizer backoffice; once
   * `publishedAt` is set the session is live to every participant who can
   * read the event. `null` === draft.
   */
  publishedAt: z.string().datetime().nullable().default(null),
  /**
   * Who published this session. Set on the same tx as publishedAt.
   * Used for audit and for the "published by …" tooltip in the organizer
   * timeline.
   */
  publishedBy: z.string().nullable().default(null),
});
```

No migration beyond a backfill to `publishedAt = createdAt, publishedBy =
createdBy` for existing sessions — we don't want to retroactively hide the
live programme of events already running.

### 3.2 `Event` schema — optional aggregate

For UI convenience (a single "Publier l'agenda" button, a "last published"
meta on the programme tab), add:

```ts
agendaPublishedAt: z.string().datetime().nullable().default(null);
agendaPublishedBy: z.string().nullable().default(null);
agendaVersion: z.number().int().nonnegative().default(0);
```

`agendaVersion` is bumped on every publish/republish. The mobile app uses
it as the cache key (`agenda:${eventId}:${version}`), so participants who
hit a cached programme see the new version as soon as their token refresh
carries the new number.

---

## 4. API surface

### 4.1 Endpoints

| Method | Path                                      | Purpose                                                                | Auth                    |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| GET    | `/v1/events/:eventId/sessions`            | List sessions. Published-only for visitors; organizers see drafts too. | optional                |
| POST   | `/v1/events/:eventId/sessions`            | Create a draft session.                                                | `event:manage_sessions` |
| PATCH  | `/v1/events/:eventId/sessions/:sessionId` | Edit a draft or published session.                                     | `event:manage_sessions` |
| DELETE | `/v1/events/:eventId/sessions/:sessionId` | Soft-delete a session.                                                 | `event:manage_sessions` |
| POST   | `/v1/events/:eventId/agenda/publish`      | Publish every currently-draft session at once.                         | `event:publish`         |
| POST   | `/v1/events/:eventId/agenda/unpublish`    | Revert every published session back to draft.                          | `event:publish`         |

The list endpoint filters by publish state based on the caller:

```
if caller has event:manage_sessions for this org → return all (draft + published + deleted-for-undo)
else if event.status === "published" → return sessions where publishedAt != null
else → 403 (unpublished event)
```

### 4.2 Service layer (pseudocode)

```ts
async publishAgenda(eventId, user) {
  requirePermission(user, "event:publish");
  const event = await eventRepo.findByIdOrThrow(eventId);
  requireOrganizationAccess(user, event.organizationId);

  const now = new Date().toISOString();
  const [updated, version] = await db.runTransaction(async (tx) => {
    const snap = await tx.get(eventRepo.ref.doc(eventId));
    const currentVersion = snap.data()?.agendaVersion ?? 0;
    const nextVersion = currentVersion + 1;

    // Mark all draft sessions as published.
    const draftSnap = await tx.get(
      sessionRepo.ref
        .where("eventId", "==", eventId)
        .where("publishedAt", "==", null)
        .where("deletedAt", "==", null),
    );
    draftSnap.forEach((doc) =>
      tx.update(doc.ref, { publishedAt: now, publishedBy: user.uid, updatedAt: now }),
    );

    tx.update(eventRepo.ref.doc(eventId), {
      agendaPublishedAt: now,
      agendaPublishedBy: user.uid,
      agendaVersion: nextVersion,
      updatedAt: now,
    });

    return [draftSnap.size, nextVersion];
  });

  eventBus.emit("agenda.published", {
    eventId,
    organizationId: event.organizationId,
    sessionsPublished: updated,
    version,
    isFirstPublish: (event.agendaVersion ?? 0) === 0,
    actorId: user.uid,
    requestId: getRequestId(),
    timestamp: now,
  });
}
```

Firestore index requirement for the draft scan:
`sessions: eventId ASC, publishedAt ASC, deletedAt ASC`.
This goes into `firestore.indexes.json` alongside the agenda feature flag.

**500-doc transaction cap.** Firestore transactions can read/write at most
500 documents. The pseudocode above assumes a typical agenda (< 100
sessions). For events that exceed that — think multi-track week-long
conferences — the publish action must:

1. Read a count (via `collection.count()`) to detect the overflow case
   and fail fast with `ValidationError("Agenda trop volumineux pour
publication atomique — contactez le support.")`, OR
2. Split the publish into a pre-computed session-id list, increment the
   `agendaVersion` inside the transaction, then fan out session
   `publishedAt` writes via chunked `db.batch()` commits outside the
   transaction. Loses atomicity across the boundary (a crash between the
   version bump and the batch flush leaves half-published sessions), so
   the listener has to reconcile by re-reading draft sessions of the
   same version on retry.

Decision: start with path (1) — reject agendas > 480 sessions (leave
headroom for the event doc + 19 reserved slots) and revisit if a real
customer hits the cap. Simpler, no half-committed states.

### 4.3 Domain events

Add to `apps/api/src/events/domain-events.ts`:

```ts
export interface AgendaPublishedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
  sessionsPublished: number;
  version: number;
  /** First time this agenda is being published. Controls whether
      participants get a "now available" notification vs "updated". */
  isFirstPublish: boolean;
}

export interface AgendaUnpublishedEvent extends BaseEventPayload {
  eventId: string;
  organizationId: string;
}
```

Re-use the existing `session.created` / `session.updated` / `session.deleted`
events for per-session changes post-publish.

---

## 5. Listener wiring

### 5.1 Agenda-publish notification listener

New listener `apps/api/src/events/listeners/agenda.listener.ts`:

```ts
eventBus.on("agenda.published", async (payload) => {
  const event = await eventRepository.findById(payload.eventId);
  if (!event) return;

  const title = payload.isFirstPublish ? "Programme disponible" : "Programme mis à jour";
  const body = payload.isFirstPublish
    ? `Le programme de « ${event.title} » est maintenant en ligne.`
    : `Le programme de « ${event.title} » a été mis à jour.`;

  await notifyConfirmedParticipants(payload.eventId, {
    type: "event_published", // reuse the existing NotificationType
    title,
    body,
    data: {
      eventId: payload.eventId,
      agendaVersion: String(payload.version),
      kind: "agenda_published",
    },
  });
});
```

`notifyConfirmedParticipants` paginates via `findByEventCursor` the same way
the existing `event.cancelled` listener does, so no new Firestore pattern
is introduced.

### 5.2 Per-session change notifications

The existing `session.updated` listener is quiet today. Upgrade it to notify
bookmarking users (high-signal subset — they already expressed interest):

```ts
eventBus.on("session.updated", async (payload) => {
  const session = await sessionRepository.findById(payload.sessionId);
  if (!session?.publishedAt) return; // nothing visible to anyone yet

  const bookmarkers = await sessionBookmarkRepository.findByEventAndSession(
    payload.eventId,
    payload.sessionId,
  );
  const materialChange =
    payload.changes.includes("startTime") ||
    payload.changes.includes("endTime") ||
    payload.changes.includes("location");
  if (!materialChange) return;

  for (const bk of bookmarkers) {
    await notificationService.send({
      userId: bk.userId,
      type: "event_updated",
      title: "Session modifiée",
      body: `« ${session.title} » a été modifiée.`,
      data: { eventId: payload.eventId, sessionId: session.id },
    });
  }
});
```

Heuristic: only material changes (time or location) trigger a push. A typo
fix on the description should not page every bookmarker.

### 5.3 Snapshot fan-out

The `event.updated` → registration denormalization listener that ships in
this PR already handles title/date/slug drift. No extra work is needed for
the agenda feature because sessions don't have denormalized mirrors.

---

## 6. Permissions

Today `event:manage_sessions` is included in `organizer` and `co_organizer`
default role sets. Keep that, but:

- Add `event:publish` as the gate for `agenda/publish` and `agenda/unpublish`
  — publishing is a release action that only full organizers should own, not
  co-organizers who might only have scoped editing. Re-uses the existing
  permission, no new string.
- Keep the participant view permissionless (anonymous-readable for published
  events, matching the existing `/v1/events/:eventId` behaviour). The PR
  that ships with this doc already moved `GET /sessions` to `optionalAuth`.

---

## 7. Firestore rules

```javascript
match /sessions/{sessionId} {
  allow read: if isEventPublished(resource.data.eventId) &&
                 resource.data.publishedAt != null ||
                 isOrgMember(resource.data.eventId);
  allow create, update, delete: if hasPermission("event:manage_sessions",
                                                 resource.data.eventId);
  // Immutability: eventId can never be reassigned after create.
  allow update: if request.resource.data.eventId == resource.data.eventId;
}
```

`isEventPublished` is a helper function that reads the parent event; cost a
single doc read. For high-traffic listing endpoints the API service still
does a bulk scan so rules are the defense-in-depth layer.

---

## 8. Client wiring

### 8.1 Backoffice (`apps/web-backoffice`)

- New "Programme" tab on the event detail. Two sections: **Brouillon** (draft
  sessions) and **Publiée** (published sessions), separated by a sticky
  "Publier l'agenda" bar that shows draft count + last-published timestamp.
- The bar's CTA calls `POST /agenda/publish` and shows a confirmation toast
  with the participant count that will receive the notification (read from
  `event.registeredCount`).
- After publish, the tab merges both sections into a single timeline.

### 8.2 Participant web (`apps/web-participant`)

- Public event page (`/events/[slug]`) already has a "Programme" section.
  The fix that ships with this PR makes the sessions fetch public, so the
  section starts rendering for published events.
- Authenticated schedule page (`/events/[slug]/schedule`) gets a
  `useAgendaVersion` hook that invalidates the React-Query cache when the
  user's FCM push carries a new `agendaVersion`.
- The save-event flow (already present) is the nudge: participants who
  saved an event but haven't registered still get the FCM push because they
  hold an entry in the `savedEvents` collection.

### 8.3 Mobile (`apps/mobile`, Wave 9)

- Hive box key becomes `agenda:${eventId}:${version}`. The FCM handler
  updates the stored version so the next app open re-fetches.
- Offline badge check-in is unaffected — the programme cache is independent
  of the QR sync cache.

---

## 9. Analytics & ops

- New audit-log action: `agenda.published` (reuses the audit listener
  pattern). Fields: `eventId`, `sessionsPublished`, `version`.
- Cloud Logging metric `teranga.agenda.publish.count` (derived) — tracks
  publish cadence so we can detect "organizer keeps republishing" churn.
- GrowthBook feature flag `agenda_publish_flow` gates the backoffice UI so
  we can dark-launch behind the existing test org before exposing it on
  production.

---

## 10. Staging / migration plan

1. Ship the schema addition (`publishedAt`, `publishedBy`, `agendaVersion`)
   behind the `agenda_publish_flow` flag. Backfill `publishedAt` to
   `createdAt` on every existing session.
2. Ship the API endpoints + listeners. Flag-gated at the route level so
   unknown callers 404 until the flag flips.
3. Ship the backoffice UI + the participant push handler. Verify end-to-end
   on `teranga-app-990a8` (staging project).
4. Flip the flag for `Teranga Events SRL` (seed org) first; verify for a
   full event cycle. Then flip globally.

Rollback: flag disable + backfill `publishedAt = createdAt` so no participant
experience changes. No data loss because we never destructively rewrite
sessions during publish — only `publishedAt` is set.

---

## 11. Out of scope for this iteration

- **Session-level publish timing** (schedule-ahead for "publish at 14h").
  Deferred until organizers ask for it; the current workflow is synchronous.
- **Attendee tracks / personalised agenda.** Today bookmarks are flat;
  per-track filtering is Wave 10.
- **Speaker confirmation status gating publish.** Nice-to-have but the
  publish action is organizer-authored, not an automated workflow.

---

## 12. Related work in this PR

- ✅ `event.updated` → registration denormalization fan-out (listener).
- ✅ Public (`optionalAuth`) read access on `/v1/events/:eventId/sessions`.
- ✅ Remove `event:read` gate from `/sessions-bookmarks` (participants hold
  their own bookmarks, not the organizer permission).
- ✅ Missing composite index added for the
  `category + location.city + status + isPublic + startDate` search shape.
- ✅ Firestore index linter now expands conditional filters into subset
  query shapes so the staging miss is caught pre-deploy.
