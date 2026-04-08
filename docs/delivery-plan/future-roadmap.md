# Future Roadmap (Post-Launch)

**Status:** Planning
**Scope:** Features to consider after the initial 10-wave launch.

These items are ordered by estimated impact for the Senegalese/West African market.

---

## Recently Shipped (Pre-Launch)

### Super Admin Panel ✅
- Platform-wide dashboard (users, orgs, events, revenue, venues)
- User management (role changes, suspend/activate, synced Firebase Auth claims)
- Organization management (verify, suspend)
- Cross-org event oversight
- Audit log viewer with filters
- Admin sidebar + command palette entries

### Venue Host Platform (Phases 1-2 ✅, Phase 3 pending)
- Venue as first-class entity (9 types: hotel, conference center, coworking, etc.)
- Venue lifecycle: pending → approved → suspended/archived
- Venue API: CRUD, public listing, events at venue
- Event-venue linking with denormalized `venueName` and `eventCount` counter
- `venue_manager` role with organization-scoped permissions
- **Pending (Phase 3):** Venue host backoffice dashboard, venue selector in event creation, participant venue display

---

## High Priority (Post-Launch Quarter 1)

### 1. Multi-language Content
- Event content in French, English, and Wolof simultaneously
- Organizer can add translations per field
- Participant sees content in their preferred language

### 2. Advanced Analytics & Insights
- Attendee demographics and behavior patterns
- Post-event survey integration
- Comparative analytics across events
- Exportable reports for sponsors

### 3. Recurring Events
- Weekly, monthly, annual event series
- Template-based event creation from series
- Series-level analytics

### 4. Waitlist Automation
- Smart waitlist promotion based on ticket type availability
- Automated notifications with payment deadline
- Priority waitlist (VIP, early bird)

## Medium Priority (Quarter 2-3)

### 5. Custom Roles per Organization
- Organizers define custom roles (beyond system roles)
- Granular permission assignment per custom role
- Role templates for common setups

### 6. Webhook System
- Organizers configure webhooks for events (registration, check-in, payment)
- Standard webhook payload format
- Retry with exponential backoff
- Webhook delivery logs

### 7. Multi-Currency Support
- Support for other WAEMU currencies and non-CFA currencies
- Currency conversion display
- Multi-currency financial reporting

### 8. White-Label / Custom Branding
- Organizer-specific branding on badge PDFs
- Custom email templates with org branding
- Custom domain for event pages

### 9. Advanced Event Discovery (extends Wave 3 participant web)
- Location-based discovery with map view
- Recommendation engine (based on past attendance, categories)
- Featured events and paid promotion placements
- Event series and recurring event discovery

### 10. Offline-First Web (PWA)
- Participant web app: offline-cached event details for registered events
- Web backoffice: offline for critical reads
- Service worker caching strategy
- Background sync for mutations

## Lower Priority (Quarter 3+)

### 11. AI-Powered Features
- Event description generation from keywords
- Smart scheduling (avoid session conflicts)
- Attendance prediction
- Chatbot for participant FAQs

### 12. Gamification
- Attendance streaks and badges
- Session attendance rewards
- Leaderboard for active participants
- Sponsor booth visit challenges

### 13. Video Integration
- Live streaming for hybrid events
- Session recording and replay
- Video chat for networking

### 14. Third-Party Integrations
- Calendar export (Google Calendar, iCal)
- CRM integration (HubSpot, Salesforce) for sponsors
- Social media auto-posting
- Zapier/Make integration via webhooks

---

## Decision Criteria for Prioritization

When deciding which post-launch features to build next:

1. **User demand** — what are beta organizers asking for most?
2. **Revenue impact** — does it unlock a new revenue stream or increase ARPU?
3. **Market fit** — does it address a specific West African market need?
4. **Technical complexity** — can it be shipped in under 2 weeks?
5. **Competitive advantage** — does it differentiate Teranga from generic platforms?
