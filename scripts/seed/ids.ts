/**
 * Stable document IDs used across seed modules.
 *
 * Every module reads from this single map so that cross-references
 * between collections (a registration pointing at an event, a session
 * pointing at a speaker, an audit log pointing at a registration) stay
 * coherent without each module needing to know the other's naming scheme.
 *
 * Two families coexist here:
 *
 *   1. **Legacy literals** (`event-001`, `org-001`, `reg-001`, …)
 *      — IDs established by PR A. Kept verbatim so cached test URLs,
 *      screenshots, bookmarks in staging, and existing tests don't
 *      break. Every module that used these before PR B continues to
 *      use them.
 *
 *   2. **Expansion ranges** (`event-005` through `event-020`, 30 new
 *      user UIDs, 11 new venue IDs, etc.) — added by PR B for the
 *      multi-city, multi-category, multi-plan demo data. Numbered with
 *      leading zeros so they sort naturally in the Firestore UI.
 *
 * The UIDs follow the existing `<role>-uid-NNN` convention so console
 * output stays scannable and admin UIs can pattern-match to roles.
 */

// ─── Organizations ─────────────────────────────────────────────────────────
// Original 4 come from PR A. `starter2` and `pro2` are the expansion.

export const ORG_IDS = {
  teranga: "org-001", // pro — Teranga Events
  venues: "org-002", // starter — Dakar Venues & Hospitality
  startup: "org-003", // free — Startup Dakar
  sonatel: "org-004", // enterprise — Groupe Sonatel Events
  abidjanCollective: "org-005", // starter — Abidjan-based Francophone expansion
  culturalPro: "org-006", // pro — Senegalese cultural events (concerts, festivals)
} as const;

export type OrgKey = keyof typeof ORG_IDS;

// ─── Users ────────────────────────────────────────────────────────────────
// Original 13 UIDs (including PR #59 role-coverage fixtures) are preserved
// byte-for-byte. Everything numbered ≥ 002 in a family is new. Keeping
// UIDs readable/grepable helps debugging — every `participant-uid-NNN` IS
// a participant, no need to reverse-lookup in Firestore.

export const USER_IDS = {
  // ── Legacy (PR A) ──────────────────────────────────────────────────────
  organizer: "organizer-uid-001",
  coOrganizer: "coorg-uid-001",
  participant1: "participant-uid-001",
  participant2: "participant-uid-002",
  speakerUser: "speaker-uid-001",
  sponsorUser: "sponsor-uid-001",
  superAdmin: "superadmin-uid-001",
  venueManager: "venuemanager-uid-001",
  freeOrganizer: "freeorg-uid-001",
  enterpriseOrganizer: "enterprise-uid-001",
  // PR #59 role-coverage fixtures
  staffUser: "staff-uid-001",
  multiRoleUser: "multirole-uid-001",
  authOnlyUser: "authonly-uid-001",

  // ── PR B expansion ─────────────────────────────────────────────────────
  // Additional organizers for the 2 new orgs.
  abidjanOrganizer: "organizer-uid-002",
  culturalOrganizer: "organizer-uid-003",
  // 2 more co-organizers to let events have a realistic "3 co-organizers" fan-out.
  coOrganizer2: "coorg-uid-002",
  coOrganizer3: "coorg-uid-003",
  // 3 more speakers so 20 events can actually have distinct speakers.
  speaker2: "speaker-uid-002",
  speaker3: "speaker-uid-003",
  speaker4: "speaker-uid-004",
  // 2 more sponsors (silver + bronze tier for the sponsor portal demo).
  sponsor2: "sponsor-uid-002",
  sponsor3: "sponsor-uid-003",
  // 1 more staff user so a second event has its own scanner.
  staff2: "staff-uid-002",
  // Participant pool — 18 more to reach 20 total. Named to evoke common
  // Senegalese / francophone West African first names for realistic demos.
  participant3: "participant-uid-003",
  participant4: "participant-uid-004",
  participant5: "participant-uid-005",
  participant6: "participant-uid-006",
  participant7: "participant-uid-007",
  participant8: "participant-uid-008",
  participant9: "participant-uid-009",
  participant10: "participant-uid-010",
  participant11: "participant-uid-011",
  participant12: "participant-uid-012",
  participant13: "participant-uid-013",
  participant14: "participant-uid-014",
  participant15: "participant-uid-015",
  participant16: "participant-uid-016",
  participant17: "participant-uid-017",
  participant18: "participant-uid-018",
  participant19: "participant-uid-019",
  participant20: "participant-uid-020",
} as const;

export type UserKey = keyof typeof USER_IDS;

// ─── Events ───────────────────────────────────────────────────────────────
// Legacy IDs (event-001 … 004) are load-bearing for registrations, badges,
// sessions, speakers, sponsors, feed posts, and audit logs in PR A. Do NOT
// renumber them. Expansion is event-005 … event-020.

export const EVENT_IDS = {
  // Legacy (PR A)
  conference: "event-001", // Dakar Tech Summit 2026 — published, free, large
  workshop: "event-002", // Atelier Flutter & Firebase — draft, paid
  meetup: "event-003", // Meetup Dev Dakar — cancelled
  paidEvent: "event-004", // Masterclass IA Générative — published, paid

  // PR B expansion — named so the purpose is obvious without opening the file
  pastConference: "event-005", // completed conference — history in analytics
  liveFestival: "event-006", // currently running — tests "live now" badge
  upcomingConcert: "event-007", // concert category coverage
  upcomingFestival: "event-008", // festival category coverage (multi-day)
  onlineWebinar: "event-009", // online-only format coverage
  hybridNetworking: "event-010", // hybrid format coverage
  upcomingTraining: "event-011", // training category coverage
  upcomingExhibition: "event-012", // exhibition category coverage
  upcomingCeremony: "event-013", // ceremony category coverage
  upcomingSport: "event-014", // sport category coverage
  abidjanConference: "event-015", // Abidjan geography coverage
  salyRetreat: "event-016", // Saly geography (beach workshop)
  thiesMeetup: "event-017", // Thiès geography (small networking)
  saintLouisJazz: "event-018", // Saint-Louis geography (concert)
  pastWorkshop: "event-019", // another "completed" status for history
  freePlanMeetup: "event-020", // event owned by the free-plan org (exercises plan gating)
} as const;

export type EventKey = keyof typeof EVENT_IDS;

// ─── Venues ───────────────────────────────────────────────────────────────
// Legacy venue-001/002/003 are referenced by events 1 and 4. Expansion fills
// the geography gap: Saly beach, Thiès cultural, Saint-Louis jazz, Abidjan
// hotel, etc. Total = 14.

export const VENUE_IDS = {
  // Legacy (PR A)
  cicad: "venue-001", // conference center — Dakar
  radisson: "venue-002", // hotel — Dakar
  jokkolabs: "venue-003", // coworking — Dakar (pending)

  // PR B expansion — Dakar
  grandTheatre: "venue-004", // cultural space — Dakar
  kingFahdPalace: "venue-005", // hotel — Dakar
  stadeLSS: "venue-006", // sports — Dakar
  museeCivilisations: "venue-007", // cultural space — Dakar
  esplanadeAlmadies: "venue-008", // outdoor — Dakar

  // PR B — rest of Senegal
  salyResort: "venue-009", // hotel — Saly
  espaceThies: "venue-010", // cultural space — Thiès
  saintLouisJazz: "venue-011", // cultural space — Saint-Louis

  // PR B — Côte d'Ivoire
  sofitelIvoire: "venue-012", // hotel — Abidjan
  goetheAbidjan: "venue-013", // cultural space — Abidjan

  // PR B — university
  ucadCampus: "venue-014", // university — Dakar (Université Cheikh Anta Diop)
} as const;

export type VenueKey = keyof typeof VENUE_IDS;

// ─── Legacy structural IDs (unchanged from PR A) ──────────────────────────

export const REGISTRATION_IDS = {
  reg1: "reg-001",
  reg2: "reg-002",
  reg3: "reg-003",
  reg4: "reg-004",
  reg5: "reg-005",
  reg6: "reg-006",
} as const;

export const SESSION_IDS = {
  session1: "session-001",
  session2: "session-002",
  session3: "session-003",
  session4: "session-004",
} as const;

export const SPEAKER_IDS = {
  speaker1: "speaker-001",
  speaker2: "speaker-002",
} as const;

export const SPONSOR_IDS = {
  sponsor1: "sponsor-001",
  sponsor2: "sponsor-002",
} as const;

export const PAYMENT_IDS = {
  payment1: "payment-001",
  payment2: "payment-002",
} as const;

export const FEED_IDS = {
  post1: "post-001",
  post2: "post-002",
  post3: "post-003",
  comment1: "comment-001",
  comment2: "comment-002",
} as const;

export const CONVERSATION_IDS = {
  conv1: "conv-001",
  conv2: "conv-002",
} as const;

export const BROADCAST_IDS = {
  broadcast1: "broadcast-001",
} as const;
