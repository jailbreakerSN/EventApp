# Wave 4: Organizer Productivity

**Status:** `completed`
**Estimated effort:** 2 weeks
**Goal:** Give organizers the tools to manage their events efficiently — team management, analytics, and organization settings.

## Why This Wave Matters

After the core loop (Wave 1) and check-in (Wave 2), organizers need productivity tools to manage events at scale. This wave turns Teranga from a registration tool into an event management platform.

---

## Tasks

### API (Fastify)

#### Organization Management
- [x] Organization settings update (name, logo, description, contact info)
- [x] Organization member management (invite, remove, change role)
- [x] Organization-level analytics endpoint
- [x] Plan/subscription management endpoints (free, starter, pro, enterprise)
- [x] Plan limit enforcement in event creation and registration

#### Team & Roles
- [x] Invite member by email endpoint (generates invite token or sends email)
- [x] Accept/decline invite endpoint
- [ ] Co-organizer assignment to specific events *(deferred to Wave 8)*
- [ ] Staff assignment to events with access zone permissions *(deferred to Wave 8)*
- [ ] Speaker/sponsor invitation flow *(deferred to Wave 8)*

#### Event Analytics
- [x] Registration analytics: registrations over time, by ticket type, by status
- [x] Check-in analytics: check-ins over time, by zone, peak hours
- [ ] Revenue analytics placeholder (for Wave 6 payments)
- [ ] Export analytics as CSV/PDF *(deferred)*

#### Event Duplication
- [x] Clone event endpoint (deep copy with new dates, reset counters)
- [ ] Event template system (save event as template, create from template) *(deferred)*

### Web Backoffice

- [x] Organization settings page (name, description, contact, city, website)
- [x] Team management page (member list, invite with role selector, revoke)
- [ ] Invite acceptance page (public, no auth required initially) *(deferred)*
- [x] Event analytics dashboard (charts: registrations, check-ins, category, ticket type)
  - [x] Chart library integration (recharts)
  - [x] Timeframe picker for analytics (7d, 30d, 90d, 12m, all)
- [x] Event duplication action (clone with dates 1 month ahead)
- [x] Plan display in organization page

### Mobile (Flutter) — DEFERRED TO WAVE 9

> Deferred: Organization switcher, mobile event management, push notification preferences.

### Shared Types

- [x] Organization invite schema (create, accept, decline, expire, token-based)
- [x] Analytics query/response schemas (time series, category, ticket type, top events)
- [x] Event clone request schema (with copyTicketTypes/copyAccessZones options)
- [x] OrgMemberRole schema (owner/admin/member/viewer)
- [x] New audit actions (event.cloned, invite.*, member.role_changed, organization.updated)

---

## Exit Criteria

- [x] Organizer can manage organization settings and team members
- [x] Organizer can invite new team members by email
- [ ] Co-organizers can manage assigned events *(deferred to Wave 8)*
- [x] Event analytics dashboard shows registration and check-in trends
- [x] Organizer can duplicate an event
- [x] Plan limits are enforced (e.g., free plan max 3 members on free)
- [x] All new endpoints tested

## Dependencies

- Wave 2 completed (check-in data exists for analytics)
- Email service for invitations (can use Firebase Auth email or defer to Wave 6)

## Deploys After This Wave

- API: Organization, team, analytics, duplication endpoints
- Web: Organization settings, team management, analytics dashboard
- Mobile: Deferred to Wave 9
