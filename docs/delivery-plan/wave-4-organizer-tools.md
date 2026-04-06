# Wave 4: Organizer Productivity

**Status:** `not_started`
**Estimated effort:** 2 weeks
**Goal:** Give organizers the tools to manage their events efficiently — team management, analytics, and organization settings.

## Why This Wave Matters

After the core loop (Wave 1) and check-in (Wave 2), organizers need productivity tools to manage events at scale. This wave turns Teranga from a registration tool into an event management platform.

---

## Tasks

### API (Fastify)

#### Organization Management
- [ ] Organization settings update (name, logo, description, contact info)
- [ ] Organization member management (invite, remove, change role)
- [ ] Organization-level analytics endpoint
- [ ] Plan/subscription management endpoints (free, starter, pro, enterprise)
- [ ] Plan limit enforcement in event creation and registration

#### Team & Roles
- [ ] Invite member by email endpoint (generates invite token or sends email)
- [ ] Accept/decline invite endpoint
- [ ] Co-organizer assignment to specific events
- [ ] Staff assignment to events with access zone permissions
- [ ] Speaker/sponsor invitation flow

#### Event Analytics
- [ ] Registration analytics: registrations over time, by ticket type, by status
- [ ] Check-in analytics: check-ins over time, by zone, peak hours
- [ ] Revenue analytics placeholder (for Wave 6 payments)
- [ ] Export analytics as CSV/PDF

#### Event Duplication
- [ ] Clone event endpoint (deep copy with new dates, reset counters)
- [ ] Event template system (save event as template, create from template)

### Web Backoffice

- [ ] Organization settings page
- [ ] Team management page (member list, invite, role change, remove)
- [ ] Invite acceptance page (public, no auth required initially)
- [ ] Event analytics dashboard (charts: registrations, check-ins, revenue)
  - [ ] Chart library integration (recharts or chart.js)
  - [ ] Date range picker for analytics
- [ ] Event duplication action
- [ ] Plan/subscription display and upgrade flow placeholder

### Mobile (Flutter) — DEFERRED TO WAVE 9

> Deferred: Organization switcher, mobile event management, push notification preferences.

### Shared Types

- [ ] Organization invite schema
- [ ] Analytics query/response schemas
- [ ] Event clone request schema
- [ ] Plan limit types (already have `PLAN_LIMITS` — extend if needed)

---

## Exit Criteria

- [ ] Organizer can manage organization settings and team members
- [ ] Organizer can invite new team members by email
- [ ] Co-organizers can manage assigned events
- [ ] Event analytics dashboard shows registration and check-in trends
- [ ] Organizer can duplicate an event
- [ ] Plan limits are enforced (e.g., free plan max 2 events)
- [ ] All new endpoints tested

## Dependencies

- Wave 2 completed (check-in data exists for analytics)
- Email service for invitations (can use Firebase Auth email or defer to Wave 6)

## Deploys After This Wave

- API: Organization, team, analytics, duplication endpoints
- Web: Organization settings, team management, analytics dashboard
- Mobile: Deferred to Wave 9
