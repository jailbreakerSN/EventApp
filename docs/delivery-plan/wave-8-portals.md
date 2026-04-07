# Wave 8: Sponsor & Speaker Portals

**Status:** `partial` — backend CRUD done, self-service portals incomplete, no upload UI
**Estimated effort:** 1.5 weeks
**Goal:** Self-service portals for sponsors and speakers — two key stakeholder groups that drive event revenue and content quality.

## Why This Wave Matters

Sponsors fund events. Speakers make events worth attending. Both need dedicated tools to manage their presence, collect leads, and deliver content. Self-service portals reduce organizer workload and improve stakeholder satisfaction.

---

## Tasks

### API (Fastify)

#### Speaker Portal
- [ ] Speaker profile management (bio, photo, social links, topics)
- [ ] Speaker session assignment and schedule view
- [ ] Speaker document upload (slides, handouts)
- [ ] Speaker-specific feed post creation
- [ ] Speaker analytics (session attendance, feedback ratings)

#### Sponsor Portal
- [ ] Sponsor profile/booth management (logo, description, links, offers)
- [ ] Sponsor tier system (gold, silver, bronze — organizer-defined)
- [ ] Lead collection endpoint (sponsors scan participant badges)
- [ ] Lead export (CSV) for sponsors
- [ ] Sponsor analytics (booth visits, leads collected, impressions)
- [ ] Sponsor content in event feed (promoted posts)

#### Lead Scanning
- [ ] Sponsor QR scanner: scan participant badge → collect lead
- [ ] Lead enrichment (pull participant name, email, company from profile)
- [ ] Lead notes (sponsor can add notes per lead)
- [ ] Lead tagging/categorization

### Web Backoffice

- [ ] Sponsor management page (add sponsors, assign tiers)
- [ ] Speaker management page (add speakers, assign sessions)
- [ ] Sponsor/speaker invitation flow
- [ ] Sponsor tier configuration (name, perks, pricing)

### Web Participant App

- [ ] Speaker profile page (public, SEO-indexed)
- [ ] Sponsor booth/directory page (public, SEO-indexed)
- [ ] Speaker self-service portal (edit profile, upload slides, view schedule)
- [ ] Sponsor self-service portal (manage booth, view leads)

### Mobile (Flutter) — DEFERRED TO WAVE 9

> Deferred: Speaker/sponsor screens, sponsor lead scanner (QR-based, requires camera), lead list and notes.

### Shared Types

- [ ] Speaker profile schemas
- [ ] Sponsor profile and tier schemas
- [ ] Lead collection schemas
- [ ] Sponsor analytics schemas

---

## Exit Criteria

- [ ] Speakers can manage their profile and view their session schedule
- [ ] Speakers can upload presentation materials
- [ ] Sponsors can manage their booth/profile
- [ ] Sponsors can scan participant badges to collect leads
- [ ] Sponsors can export collected leads as CSV
- [ ] Organizer can manage sponsors and speakers in backoffice
- [ ] Sponsor/speaker tiers work correctly

## Dependencies

- Wave 1 (events, registrations, badges)
- Wave 5 (sessions for speaker assignment, feed for sponsor posts)
- QR scanning infrastructure (from Wave 2)

## Deploys After This Wave

- API: Speaker, sponsor, lead collection endpoints
- Web: Speaker/sponsor management pages
- Mobile: Deferred to Wave 9
