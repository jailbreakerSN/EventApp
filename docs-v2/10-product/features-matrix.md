# Feature Matrix

> **Status legend:** ✅ shipped · ⚠ partial · 🔲 stub · 📅 planned

This matrix maps each feature to the personas that can use it and its implementation status.

---

## Event management

| Feature | Organizer | Co-org | Staff | Super-admin | Status |
|---|---|---|---|---|---|
| Create / edit / delete event | ✅ | ✅ (scoped) | — | ✅ | ✅ shipped |
| Publish / unpublish | ✅ | ✅ | — | ✅ | ✅ shipped |
| Clone event | ✅ | — | — | ✅ | ✅ shipped |
| Ticket types CRUD | ✅ | ✅ | — | ✅ | ✅ shipped |
| Access zones CRUD | ✅ | ✅ | — | ✅ | ✅ shipped |
| Scan policy (single / multi-day / multi-zone) | ✅ (Pro+) | ✅ | — | ✅ | ✅ shipped |
| QR key rotation | ✅ | — | — | ✅ | ✅ shipped |
| Sessions / agenda CRUD | ✅ | ✅ | — | ✅ | ✅ shipped |
| Speakers management | ✅ (Pro+) | ✅ | — | ✅ | ✅ shipped |
| Sponsors management | ✅ (Pro+) | ✅ | — | ✅ | ⚠ partial |
| Promo codes | ✅ (Starter+) | ✅ | — | ✅ | ✅ shipped |

---

## Registration

| Feature | Participant | Organizer | Co-org | Status |
|---|---|---|---|---|
| Register for free event | ✅ | — | — | ✅ shipped |
| Register for paid event | ✅ | — | — | ⚠ partial (Wave/OM only) |
| Cancel own registration | ✅ | — | — | ✅ shipped |
| Waitlist (requires approval) | ✅ | — | — | ✅ shipped |
| Auto-promote from waitlist | ✅ | — | — | ✅ shipped |
| Approve / reject registration | — | ✅ | ✅ | ✅ shipped |
| Export registrations to CSV | — | ✅ (Starter+) | ✅ | ✅ shipped |
| Apply promo code at checkout | ✅ | — | — | ✅ shipped |

---

## Check-in

| Feature | Staff | Organizer | Co-org | Status |
|---|---|---|---|---|
| Live QR scan | ✅ | ✅ | ✅ | ✅ shipped |
| Offline sync download (encrypted) | ✅ | ✅ | ✅ | ✅ shipped |
| Bulk offline reconciliation | ✅ | ✅ | ✅ | ✅ shipped |
| Manual check-in (by name/email) | ✅ | ✅ | ✅ | ✅ shipped |
| Multi-entry scan policies | — | ✅ (Pro+) | ✅ (Pro+) | ✅ shipped |
| Access zone capacity enforcement | ✅ | ✅ | ✅ | ✅ shipped |
| Scanner device attestation | ✅ | — | — | ✅ shipped |
| Real-time check-in dashboard | — | ✅ | ✅ | ✅ shipped |
| Anomaly detection widget | — | ✅ | ✅ | ✅ shipped |

---

## Badges

| Feature | Participant | Organizer | Super-admin | Status |
|---|---|---|---|---|
| Auto-generate badge on registration | ✅ | — | — | ✅ shipped |
| Download badge PDF | ✅ | ✅ | ✅ | ✅ shipped |
| Custom badge templates | — | ✅ (Starter+) | ✅ | ✅ shipped |
| Bulk badge generation | — | ✅ (Starter+) | ✅ | ✅ shipped |

---

## Analytics

| Feature | Organizer | Co-org | Super-admin | Status |
|---|---|---|---|---|
| Org-level event summary stats | ✅ | — | ✅ | ✅ shipped |
| Registration over time chart | ✅ (Pro+) | — | ✅ | ✅ shipped |
| Check-in over time chart | ✅ (Pro+) | — | ✅ | ✅ shipped |
| Revenue breakdown | ✅ (Pro+) | — | ✅ | ⚠ partial |
| Top events table | ✅ (Pro+) | — | ✅ | ✅ shipped |
| Platform-wide analytics | — | — | ✅ | ✅ shipped |

---

## Finance

| Feature | Organizer | Super-admin | Status |
|---|---|---|---|
| Balance ledger (transactions) | ✅ | ✅ | ✅ shipped |
| Payout history | ✅ | ✅ | ✅ shipped |
| Wave payment integration | ✅ | — | ✅ shipped |
| Orange Money integration | ✅ | — | ✅ shipped |
| Card payments (PayDunya/Stripe) | — | — | 🔲 stub |
| Free Money integration | — | — | 🔲 stub |
| Automated payout triggers | — | — | 📅 planned |

---

## Communications

| Feature | Organizer | Co-org | Status |
|---|---|---|---|
| In-app notifications (push) | ✅ | ✅ | ✅ shipped |
| Email broadcasts (Resend) | ✅ | ✅ | ✅ shipped |
| SMS broadcasts (Africa's Talking) | ✅ (Pro+) | ✅ (Pro+) | ✅ shipped |
| Scheduled broadcasts | ✅ | ✅ | ✅ shipped |
| Event reminders (automated) | — | — | ✅ shipped (Cloud Scheduler) |
| 1:1 participant messaging | ✅ | ✅ | ✅ shipped |

---

## Social / feed

| Feature | Participant | Organizer | Speaker | Status |
|---|---|---|---|---|
| View event feed | ✅ | ✅ | ✅ | ✅ shipped |
| Post announcement | — | ✅ | ✅ | ✅ shipped |
| Comment on post | ✅ | ✅ | ✅ | ✅ shipped |
| Pin / moderate post | — | ✅ | — | ✅ shipped |
| Session schedule + bookmarks | ✅ | ✅ | ✅ | ✅ shipped |

---

## Organization & team

| Feature | Organizer | Super-admin | Status |
|---|---|---|---|
| Create / edit organization | ✅ | ✅ | ✅ shipped |
| Invite team members | ✅ | ✅ | ✅ shipped |
| Member role management | ✅ | ✅ | ✅ shipped |
| Organization KYB verification | — | ✅ | ✅ shipped |
| Suspend / reactivate org | — | ✅ | ✅ shipped |

---

## Subscriptions & billing

| Feature | Organizer | Super-admin | Status |
|---|---|---|---|
| View current plan + usage | ✅ | ✅ | ✅ shipped |
| Upgrade plan | ✅ | ✅ | ✅ shipped |
| Downgrade plan (deferred to period end) | ✅ | ✅ | ✅ shipped |
| Cancel subscription | ✅ | ✅ | ✅ shipped |
| Custom plan overrides per org | — | ✅ (Phase 5) | ⚠ partial |
| Billing / payment method management | — | — | 🔲 stub |
| Invoice generation | — | — | 📅 planned (Phase 7) |

---

## Mobile-specific

| Feature | Participant | Staff | Status |
|---|---|---|---|
| Browse and search events | ✅ | — | ✅ shipped |
| Register for event | ✅ | — | 🔲 stub (UI shell only) |
| View digital badge + QR | ✅ | — | 🔲 stub (page shell) |
| QR scanner (staff) | — | ✅ | 🔲 stub (page shell) |
| Event feed | ✅ | — | 🔲 stub |
| 1:1 networking (future) | — | — | 📅 planned |
