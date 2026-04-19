/**
 * Central registry of fixture IDs used by every seed module.
 *
 * The monolithic `seed-emulators.ts` used to own a local `IDS` literal. After
 * the modular split (PR B), seed modules and the orchestrator all import from
 * this file so:
 *   - Legacy IDs (org-001 … org-004, event-001 … event-004, user uids, etc.)
 *     stay stable — downstream inline sections in `seed-emulators.ts`
 *     (registrations, sessions, feed, payments …) keep resolving.
 *   - New IDs introduced by the data expansion (10 additional venues,
 *     16 additional events, 27 additional participant users, 1 additional
 *     starter-plan organisation) have predictable `*-NNN` shapes so follow-up
 *     PRs (C — activity, D — social) can reference them without chasing a
 *     generated registry.
 *
 * Grouping is deliberate: ORGS / VENUES / USERS / EVENTS sit alongside the
 * modules that own them; REGS / SESSIONS / SPEAKERS / etc. remain for the
 * inline sections still resident in `seed-emulators.ts`.
 */

export const IDS = {
  // ─── Organisations ───────────────────────────────────────────────────
  orgId: "org-001", // pro — Teranga Events
  venueOrgId: "org-002", // starter — Dakar Venues & Hospitality
  freeOrgId: "org-003", // free — Startup Dakar
  enterpriseOrgId: "org-004", // enterprise — Groupe Sonatel Events
  starterOrgId: "org-005", // starter — Thiès Tech Collective (added PR B)

  // ─── Users (legacy, role-coverage fixtures) ─────────────────────────
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
  staffUser: "staff-uid-001",
  multiRoleUser: "multirole-uid-001",
  authOnlyUser: "authonly-uid-001",
  // New in PR B — organizer for the additional starter org
  starterOrganizer: "starterorg-uid-001",

  // ─── Events (legacy) ────────────────────────────────────────────────
  conference: "event-001", // Dakar Tech Summit — published free
  workshop: "event-002", // Atelier Flutter — draft paid
  meetup: "event-003", // Meetup Dakar #12 — cancelled hybrid
  paidEvent: "event-004", // Masterclass IA — published paid

  // ─── Registrations (legacy, populated by seed-emulators.ts) ────────
  reg1: "reg-001",
  reg2: "reg-002",
  reg3: "reg-003",
  reg4: "reg-004",
  reg5: "reg-005",
  reg6: "reg-006",

  // ─── Sessions, Speakers, Sponsors, Payments, Conv, etc. ─────────────
  // (still lives in seed-emulators.ts until PR C/D — IDs preserved)
  session1: "session-001",
  session2: "session-002",
  session3: "session-003",
  session4: "session-004",
  speaker1: "speaker-001",
  speaker2: "speaker-002",
  sponsor1: "sponsor-001",
  sponsor2: "sponsor-002",
  payment1: "payment-001",
  payment2: "payment-002",
  post1: "post-001",
  post2: "post-002",
  post3: "post-003",
  comment1: "comment-001",
  comment2: "comment-002",
  conv1: "conv-001",
  conv2: "conv-002",
  broadcast1: "broadcast-001",

  // ─── Venues (legacy) ────────────────────────────────────────────────
  venue1: "venue-001", // CICAD Dakar
  venue2: "venue-002", // Radisson Blu Dakar
  venue3: "venue-003", // Jokkolabs Dakar
} as const;

// ─── PR B — Expansion IDs ────────────────────────────────────────────────
// Kept out of `IDS` so a quick glance at the legacy record above reads as
// the original fixture set. The expansion modules iterate over these arrays
// rather than cherry-picking named keys.

/** 11 additional venues across francophone West Africa. */
export const EXPANSION_VENUE_IDS = [
  "venue-004", // Dakar — Les Almadies Events
  "venue-005", // Dakar — Monument de la Renaissance
  "venue-006", // Saly — Palm Beach Resort
  "venue-007", // Saly — Saly Hotel & Spa
  "venue-008", // Thiès — Palais des Congrès de Thiès
  "venue-009", // Thiès — Stade Lat Dior
  "venue-010", // Saint-Louis — Institut Français
  "venue-011", // Saint-Louis — Hotel de la Poste
  "venue-012", // Ziguinchor — Alliance Franco-Sénégalaise
  "venue-013", // Abidjan — Sofitel Abidjan Hôtel Ivoire
  "venue-014", // Bamako — Centre International de Conférences
] as const;

// NOTE: there is no `EXPANSION_EVENT_IDS` constant here — the expansion
// event catalogue lives in `04-events.ts` as `EXPANSION_EVENT_DENORM`, with
// full title / slug / dates / organisation metadata. Downstream modules
// should import from there, not from a flat ID list.

/**
 * 27 additional participant users — realistic francophone West African
 * personas spread across the 8 cities in the venue catalogue. Consumed by
 * `02-users.ts` and, later, by PR C's registrations module.
 */
export const EXPANSION_PARTICIPANT_UIDS = [
  "participant-uid-003",
  "participant-uid-004",
  "participant-uid-005",
  "participant-uid-006",
  "participant-uid-007",
  "participant-uid-008",
  "participant-uid-009",
  "participant-uid-010",
  "participant-uid-011",
  "participant-uid-012",
  "participant-uid-013",
  "participant-uid-014",
  "participant-uid-015",
  "participant-uid-016",
  "participant-uid-017",
  "participant-uid-018",
  "participant-uid-019",
  "participant-uid-020",
  "participant-uid-021",
  "participant-uid-022",
  "participant-uid-023",
  "participant-uid-024",
  "participant-uid-025",
  "participant-uid-026",
  "participant-uid-027",
  "participant-uid-028",
  "participant-uid-029",
] as const;

export type SeedId = (typeof IDS)[keyof typeof IDS];
