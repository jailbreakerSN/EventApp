# Personas

> **Status: shipped** — All 8 system roles are implemented in the permission model and enforced at the API layer.

Teranga has eight distinct user roles. Each role carries a different set of permissions and accesses different surfaces.

---

## Role overview

| Role | Scope | Primary surface | Key capability |
|---|---|---|---|
| `participant` | Global | Participant web + mobile | Register, view badge, follow feed, message |
| `organizer` | Organization | Back-office web | Full event management |
| `co_organizer` | Event | Back-office web | Event management (delegated, no org settings) |
| `staff` | Event | Mobile app | QR scan at venue |
| `speaker` | Event | Participant web + mobile | Manage speaker profile, post to feed |
| `sponsor` | Event | Back-office (sponsor tab) | Manage booth, collect leads |
| `venue_manager` | Venue | Back-office | Approve/manage venue listings |
| `super_admin` | Platform | Back-office /admin | Full platform access |

Roles are stored as an array in Firebase Auth custom claims (`roles: string[]`). The same user can hold multiple roles (e.g., a speaker who is also a participant).

---

## Participant

*The primary end user of the platform.*

**Journey:**
1. Discovers events on web participant app or mobile
2. Creates an account (email/password via Firebase Auth)
3. Registers for an event — selects ticket type, completes payment if applicable
4. Receives QR badge (PDF + in-app digital badge)
5. Checks in at the venue using the QR code
6. Follows the event live feed, messages other participants, bookmarks sessions

**Permissions:** `registration:create`, `registration:cancel_own`, `badge:view_own`, `feed:read`, `feed:create_post`, `messaging:send`, `session:bookmark`

**Surfaces:** Web participant app (primary), Flutter mobile

---

## Organizer

*The platform's paying customer. Owns the organization and all its events.*

**Journey:**
1. Signs up, creates an organization
2. Chooses a plan (free → enterprise)
3. Creates and publishes events, sets up ticket types and access zones
4. Manages registrations: approves, rejects, promotes to roles
5. Assigns staff members for event day
6. Monitors check-in progress and analytics in real time
7. Sends broadcast communications (push, SMS, email)
8. Reviews revenue and requests payouts

**Permissions:** All participant permissions + `event:*`, `registration:read_all`, `registration:approve`, `registration:export`, `badge:generate`, `checkin:*`, `organization:manage_members`, `analytics:read`, `communication:send`

**Surfaces:** Web back-office (primary). Tablet-optimized for on-site use.

**Plan dependency:** Core event creation is available on the free plan. QR scanning, badges, CSV export, analytics, and SMS require Starter or higher. See [Freemium model](./freemium-model.md).

---

## Co-organizer

*A trusted delegate who helps manage a specific event but has no access to organization settings or billing.*

**Journey:**
1. Invited to an event by the organizer with the `co_organizer` role
2. Gets the same back-office event view as the organizer — registrations, check-in, sessions, speakers, sponsors, communications — but scoped to that event only
3. Cannot access organization settings, billing, or other events in the org

**Permissions:** Same as organizer but scoped to the event (`eventId` bound in token claims). No `organization:*` permissions.

**Surfaces:** Web back-office (event pages only)

---

## Staff

*Event-day check-in operator.*

**Journey:**
1. Assigned the `staff` role for an event by the organizer
2. Before the event: downloads the offline sync snapshot via the mobile app
3. At the venue: scans participant QR codes using the camera (online or offline)
4. After the event: offline queue reconciles to the server automatically

**Permissions:** `checkin:scan`, `checkin:manual`, `registration:read_all` (read-only, for check-in display)

**Surfaces:** Flutter mobile app (scanner screen). No back-office access.

---

## Speaker

*Invited presenter or panelist at an event.*

**Journey:**
1. Organizer adds speaker to event, links to a user account
2. Speaker logs in to see their session schedule and manage their speaker profile (bio, photo, social links)
3. Speaker can post to the event feed
4. Speaker receives their badge like any participant

**Permissions:** `event:read`, `speaker:manage_own_profile`, `session:read`, `feed:create_post`, `messaging:send`, `badge:view_own`

**Surfaces:** Participant web app (speaker view), mobile app

---

## Sponsor

*Brand or company sponsoring an event.*

**Journey:**
1. Organizer creates a sponsor record for the event
2. Sponsor logs in to see their sponsor portal (booth management, leads)
3. Sponsor scans participant badges to collect leads (QR-to-profile)
4. Sponsor accesses their aggregated lead list

**Permissions:** `sponsor:manage_booth`, `sponsor:collect_leads`, `event:read`

**Surfaces:** Back-office (sponsor tab within event). Mobile (lead scanner).

> ⚠ **partial** — Sponsor portal UI is scaffolded; lead capture API is implemented. Full portal is Wave 8.

---

## Venue Manager

*Manages a physical venue and its availability.*

**Journey:**
1. Creates a venue listing with address, photos, and capacity
2. Venue is submitted for approval by a super-admin
3. Once approved, organizers can select the venue when creating events
4. Venue manager sees events scheduled at their venue

**Permissions:** `venue:create`, `venue:manage_own`, `event:read` (for their venue's events)

**Surfaces:** Back-office (/venues pages)

---

## Super Admin

*Platform operator with unrestricted access.*

**Journey:**
1. Logs into back-office `/admin` dashboard
2. Manages users: assigns roles, detects JWT↔Firestore claims drift, suspends accounts
3. Manages organizations: verifies (KYB), suspends, reactivates
4. Manages the plan catalog: creates/edits plans, sets custom limits per org
5. Views platform-wide audit logs
6. Approves venue listings

**Permissions:** `platform:manage` — implies all permissions across all organizations. Bypasses org-isolation checks in all services.

**Surfaces:** Back-office `/admin` routes (exclusive)

---

## Permission resolution

Permissions are resolved at runtime from the user's `roles` array in their Firebase Auth custom claims. The resolution logic lives in `packages/shared-types/src/permissions.types.ts` (`resolvePermissions()`).

```typescript
// Check a single permission
hasPermission(user, 'event:create')

// Check all of a set
hasAllPermissions(user, ['event:create', 'badge:generate'])

// Check any of a set
hasAnyPermission(user, ['checkin:scan', 'checkin:manual'])
```

Full permission table: [Architecture → Permissions reference](../20-architecture/reference/permissions.md)
