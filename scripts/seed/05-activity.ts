/**
 * Seed "activity" fixtures — the slice of the seed that depends on events +
 * users being written first: registrations, badges, sessions, speakers,
 * sponsors, sponsor leads, payments, receipts.
 *
 * This module extracts what used to be inline sections 5-12 of
 * `seed-emulators.ts`. Legacy fixtures (6 registrations, 2 badges, 4
 * sessions, 2 speakers, 2 sponsors, 1 lead, 2 payments, 1 receipt) are
 * preserved BYTE-FOR-BYTE because downstream inline sections 13-20 (feed
 * posts, notifications, audit logs, subscriptions) still reference them by
 * the IDs resolved through `./ids`.
 *
 * Expansion activity across event-005..020 is added by the follow-up commit
 * in this PR (see PARTICIPANT_REGISTRATIONS + SESSION_FAN_OUT below — empty
 * here, populated next commit). Keeping them as named, empty arrays on this
 * structural commit makes the diff for the data commit a pure addition.
 */

import { createHash } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";

import { Dates } from "./config";
import { IDS } from "./ids";
import { EXPANSION_PARTICIPANTS } from "./02-users";
import { EXPANSION_EVENT_DENORM, findTicketType } from "./04-events";

const {
  now,
  oneHourAgo,
  yesterday,
  oneWeekAgo,
  twoWeeksAgo,
  oneMonthAgo,
  fortyFiveDaysAgo,
  inOneWeek,
  inOneWeekPlus1h,
  inOneWeekPlus2h,
  inOneWeekPlus3h,
  inOneWeekPlus4h,
  inTenDays,
  inTwoWeeks,
  inThreeWeeks,
  inTwoMonths,
} = Dates;

// v3 QR validity window baked into the signed payload. For seed data we use
// a wide range (yesterday → one year out) so demo registrations stay
// scannable across all seeded events without rewriting fixtures per event.
// The `demo-hmac-sig-*` signatures are placeholders — the verifier will
// reject them at scan time just as it did with the pre-v3 seed strings.
const seedNotBeforeBase36 = Math.floor(Date.now() - 86_400_000).toString(36);
const seedNotAfterBase36 = Math.floor(Date.now() + 365 * 86_400_000).toString(36);

// ─── Registrations ─────────────────────────────────────────────────────────
// Denormalised event metadata copied onto each registration. The API
// populates these fields automatically on real writes (see
// apps/api/src/services/registration.service.ts); the seed has to mirror
// that contract or the calendar + my-events surfaces render empty dates.

const EVENT_DENORM: Record<
  string,
  {
    eventTitle: string;
    eventSlug: string;
    eventStartDate: string;
    eventEndDate: string;
  }
> = {
  [IDS.conference]: {
    eventTitle: "Dakar Tech Summit 2026",
    eventSlug: "dakar-tech-summit-2026",
    eventStartDate: inOneWeek,
    eventEndDate: inTwoWeeks,
  },
  [IDS.paidEvent]: {
    eventTitle: "Masterclass IA Générative",
    eventSlug: "masterclass-ia-generative",
    eventStartDate: inTwoWeeks,
    eventEndDate: inTwoWeeks,
  },
};

const TICKET_NAMES: Record<string, string> = {
  "ticket-standard-001": "Standard",
  "ticket-vip-001": "VIP",
  "ticket-standard-004": "Early Bird",
  "ticket-vip-004": "Premium",
};

type SeedRegistration = {
  id: string;
  eventId: string;
  userId: string;
  ticketTypeId: string;
  participantName: string;
  participantEmail: string;
  status: string;
  qrCodeValue: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

const LEGACY_REGISTRATIONS: SeedRegistration[] = [
  {
    id: IDS.reg1,
    eventId: IDS.conference,
    userId: IDS.participant1,
    ticketTypeId: "ticket-standard-001",
    participantName: "Aminata Fall",
    participantEmail: "participant@teranga.dev",
    status: "confirmed",
    qrCodeValue: `${IDS.reg1}:${IDS.conference}:${IDS.participant1}:${seedNotBeforeBase36}:${seedNotAfterBase36}:demo-hmac-sig-001`,
    checkedInAt: oneHourAgo,
    checkedInBy: IDS.organizer,
    notes: null,
    createdAt: yesterday,
    updatedAt: oneHourAgo,
  },
  {
    id: IDS.reg2,
    eventId: IDS.conference,
    userId: IDS.participant2,
    ticketTypeId: "ticket-standard-001",
    participantName: "Ousmane Ndiaye",
    participantEmail: "participant2@teranga.dev",
    status: "confirmed",
    qrCodeValue: `${IDS.reg2}:${IDS.conference}:${IDS.participant2}:${seedNotBeforeBase36}:${seedNotAfterBase36}:demo-hmac-sig-002`,
    checkedInAt: null,
    checkedInBy: null,
    notes: null,
    createdAt: yesterday,
    updatedAt: yesterday,
  },
  {
    id: IDS.reg3,
    eventId: IDS.conference,
    userId: IDS.speakerUser,
    ticketTypeId: "ticket-standard-001",
    participantName: "Ibrahima Gueye",
    participantEmail: "speaker@teranga.dev",
    status: "confirmed",
    qrCodeValue: `${IDS.reg3}:${IDS.conference}:${IDS.speakerUser}:${seedNotBeforeBase36}:${seedNotAfterBase36}:demo-hmac-sig-003`,
    checkedInAt: null,
    checkedInBy: null,
    notes: "Intervenant",
    createdAt: yesterday,
    updatedAt: yesterday,
  },
  {
    id: IDS.reg4,
    eventId: IDS.conference,
    userId: IDS.sponsorUser,
    ticketTypeId: "ticket-vip-001",
    participantName: "Aissatou Ba",
    participantEmail: "sponsor@teranga.dev",
    status: "confirmed",
    qrCodeValue: `${IDS.reg4}:${IDS.conference}:${IDS.sponsorUser}:${seedNotBeforeBase36}:${seedNotAfterBase36}:demo-hmac-sig-004`,
    checkedInAt: null,
    checkedInBy: null,
    notes: "Sponsor TechCorp",
    createdAt: yesterday,
    updatedAt: yesterday,
  },
  // reg5: pending_payment — qrCodeValue is a sentinel placeholder because
  // RegistrationSchema requires a non-nullable string; real pending_payment
  // registrations get the HMAC-signed payload on confirmation.
  {
    id: IDS.reg5,
    eventId: IDS.paidEvent,
    userId: IDS.participant1,
    ticketTypeId: "ticket-standard-004",
    participantName: "Aminata Fall",
    participantEmail: "participant@teranga.dev",
    status: "pending_payment",
    qrCodeValue: `pending:${IDS.reg5}`,
    checkedInAt: null,
    checkedInBy: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: IDS.reg6,
    eventId: IDS.paidEvent,
    userId: IDS.participant2,
    ticketTypeId: "ticket-vip-004",
    participantName: "Ousmane Ndiaye",
    participantEmail: "participant2@teranga.dev",
    status: "confirmed",
    qrCodeValue: `${IDS.reg6}:${IDS.paidEvent}:${IDS.participant2}:${seedNotBeforeBase36}:${seedNotAfterBase36}:demo-hmac-sig-006`,
    checkedInAt: null,
    checkedInBy: null,
    notes: null,
    createdAt: yesterday,
    updatedAt: yesterday,
  },
];

// ─── Expansion registrations ──────────────────────────────────────────────
// Fan-out of the 27 expansion participants across the 16 new events. Targets
// 3-5 registrations per event with city-aware preferences (e.g. Saly
// participants get priority on Saly events) so the "events near you" +
// participant profile pages have realistic content. Past events are pre-
// checked-in, LIVE events have a partial check-in, upcoming events have
// no check-ins yet.
//
// NOTE: the `registeredCount` field on each event document (set in
// 04-events.ts) is deliberately higher than the real count of registration
// docs we materialise here — keeping 1 500 reg docs for the Youssou N'Dour
// concert would bloat the emulator with zero additional coverage. The
// denormalised count is what the UI surfaces; the actual reg rows are a
// representative sample.

/**
 * Which ticket-type each expansion registration consumes. The other fields
 * (title / slug / start / end) come from `EXPANSION_EVENT_DENORM` in
 * `04-events.ts` — the events module is the single source of truth for
 * event metadata. This module only chooses *which* of the event's
 * ticket-types the demo registrations buy.
 */
const PRIMARY_TICKET_ID_BY_EVENT: Record<string, string> = {
  "event-005": "ticket-pass-005",
  "event-006": "ticket-marathon-006",
  "event-007": "ticket-free-007",
  "event-008": "ticket-workshop-008",
  "event-009": "ticket-formation-009",
  "event-010": "ticket-on-site-010",
  "event-011": "ticket-pelouse-011",
  "event-012": "ticket-early-012",
  "event-013": "ticket-pass-013",
  "event-014": "ticket-onsite-014",
  "event-015": "ticket-free-015",
  "event-016": "ticket-semi-016",
  "event-017": "ticket-free-017",
  "event-018": "ticket-expo-018",
  "event-019": "ticket-concert-019",
  "event-020": "ticket-stream-020",
};

type ExpansionEventMeta = {
  title: string;
  slug: string;
  startDate: string;
  endDate: string;
  ticketTypeId: string;
  ticketTypeName: string;
};

/**
 * Merge `EXPANSION_EVENT_DENORM` (title/slug/dates from 04-events.ts) with
 * `PRIMARY_TICKET_ID_BY_EVENT` (ticket choice owned by this module) at
 * module load. Failing fast here (throw on a missing event / ticket)
 * catches drift between 04-events.ts and the fan-out table below before
 * any Firestore write happens.
 */
const EXPANSION_EVENT_META: Record<string, ExpansionEventMeta> = (() => {
  const out: Record<string, ExpansionEventMeta> = {};
  for (const event of EXPANSION_EVENT_DENORM) {
    const ticketTypeId = PRIMARY_TICKET_ID_BY_EVENT[event.id];
    if (!ticketTypeId) {
      throw new Error(`PRIMARY_TICKET_ID_BY_EVENT missing entry for ${event.id}`);
    }
    const ticket = findTicketType(event.id, ticketTypeId);
    if (!ticket) {
      throw new Error(`Event ${event.id} has no ticket-type with id ${ticketTypeId}`);
    }
    out[event.id] = {
      title: event.title,
      slug: event.slug,
      startDate: event.startDate,
      endDate: event.endDate,
      ticketTypeId,
      ticketTypeName: ticket.name,
    };
  }
  return out;
})();

/**
 * One line = one registration. `p` is the 0-based index into
 * `EXPANSION_PARTICIPANTS`. `checkedIn: true` marks the reg as consumed
 * (uses the event's start date as checkedInAt so the timeline is coherent).
 */
type FanOutEntry = {
  eventId: string;
  p: number;
  checkedIn?: boolean;
  notes?: string;
};

const FAN_OUT: FanOutEntry[] = [
  // event-005 — past festival Saly, all checked-in
  { eventId: "event-005", p: 10, checkedIn: true }, // Yacine (Saly)
  { eventId: "event-005", p: 11, checkedIn: true }, // Ousseynou (Saly)
  { eventId: "event-005", p: 0, checkedIn: true }, // Mariama (Dakar)

  // event-006 — past marathon Dakar, all finished
  { eventId: "event-006", p: 5, checkedIn: true }, // Sékou
  { eventId: "event-006", p: 6, checkedIn: true }, // Aby
  { eventId: "event-006", p: 1, checkedIn: true }, // Cheikh
  { eventId: "event-006", p: 13, checkedIn: true }, // Omar (Thiès)

  // event-007 — LIVE meetup dev Dakar (2 checked-in + 1 not yet)
  { eventId: "event-007", p: 3, checkedIn: true }, // Mamadou Lamine
  { eventId: "event-007", p: 4, checkedIn: true }, // Ndeye Rama
  { eventId: "event-007", p: 7 }, // Pape Demba (arriving late)

  // event-008 — LIVE workshop Saint-Louis (2 checked-in + 1 not yet)
  { eventId: "event-008", p: 16, checkedIn: true }, // Fatou Binetou
  { eventId: "event-008", p: 17, checkedIn: true }, // Alioune Badara
  { eventId: "event-008", p: 18 }, // Ramatoulaye

  // event-009 — upcoming online formation IA Bamako
  { eventId: "event-009", p: 24 }, // Adama (Bamako)
  { eventId: "event-009", p: 25 }, // Fatoumata (Bamako)
  { eventId: "event-009", p: 26 }, // Koffi (Lomé)

  // event-010 — upcoming hybrid conference Thiès
  { eventId: "event-010", p: 13 }, // Omar
  { eventId: "event-010", p: 14 }, // Awa
  { eventId: "event-010", p: 15 }, // Modou
  { eventId: "event-010", p: 0 }, // Mariama (Dakar travelling)

  // event-011 — upcoming concert Youssou N'Dour Dakar
  { eventId: "event-011", p: 12 }, // Binta (Saly travelling)
  { eventId: "event-011", p: 8 }, // Coumba
  { eventId: "event-011", p: 9 }, // Bacary
  { eventId: "event-011", p: 2 }, // Astou

  // event-012 — upcoming Web Summit Thiès
  { eventId: "event-012", p: 13 }, // Omar
  { eventId: "event-012", p: 14 }, // Awa
  { eventId: "event-012", p: 15 }, // Modou
  { eventId: "event-012", p: 1 }, // Cheikh (Dakar travelling)

  // event-013 — upcoming festival Jazz Saint-Louis
  { eventId: "event-013", p: 16 }, // Fatou Binetou
  { eventId: "event-013", p: 17 }, // Alioune Badara
  { eventId: "event-013", p: 18 }, // Ramatoulaye

  // event-014 — upcoming Flutter Ziguinchor (1 on-site, 2 stream)
  { eventId: "event-014", p: 19 }, // Simon (Ziguinchor)
  { eventId: "event-014", p: 20 }, // Marie-Louise (Ziguinchor)
  { eventId: "event-014", p: 26, notes: "Suivi en ligne" }, // Koffi (Lomé)

  // event-015 — upcoming meetup mobile Dakar
  { eventId: "event-015", p: 5 }, // Sékou
  { eventId: "event-015", p: 6 }, // Aby
  { eventId: "event-015", p: 7 }, // Pape Demba
  { eventId: "event-015", p: 8 }, // Coumba

  // event-016 — upcoming marathon Thiès
  { eventId: "event-016", p: 13 }, // Omar
  { eventId: "event-016", p: 14 }, // Awa
  { eventId: "event-016", p: 15 }, // Modou
  { eventId: "event-016", p: 0 }, // Mariama

  // event-017 — upcoming AfricaTech online (pan-African)
  { eventId: "event-017", p: 21, notes: "Suivi depuis Abidjan" },
  { eventId: "event-017", p: 22, notes: "Suivi depuis Abidjan" },
  { eventId: "event-017", p: 23, notes: "Suivi depuis Abidjan" },
  { eventId: "event-017", p: 24, notes: "Suivi depuis Bamako" },
  { eventId: "event-017", p: 26, notes: "Suivi depuis Lomé" },

  // event-018 — upcoming expo UX Dakar
  { eventId: "event-018", p: 2 }, // Astou
  { eventId: "event-018", p: 4 }, // Ndeye Rama
  { eventId: "event-018", p: 1 }, // Cheikh

  // event-019 — upcoming concert Baaba Maal Saly
  { eventId: "event-019", p: 10 }, // Yacine
  { eventId: "event-019", p: 11 }, // Ousseynou
  { eventId: "event-019", p: 12 }, // Binta

  // event-020 — upcoming atelier IA Abidjan (hybrid)
  { eventId: "event-020", p: 21 }, // Kouamé
  { eventId: "event-020", p: 22 }, // Akissi
  { eventId: "event-020", p: 23 }, // Serge
  { eventId: "event-020", p: 0, notes: "Suivi en ligne depuis Dakar" }, // Mariama
];

/**
 * Build a 2-digit event suffix ("005" → "05") used as part of the reg id.
 */
function eventNumShort(eventId: string): string {
  const m = /event-(\d+)/.exec(eventId);
  return m ? m[1].padStart(3, "0").slice(-2) : "00";
}

function materialiseExpansionRegs(): SeedRegistration[] {
  const counter: Record<string, number> = {};
  return FAN_OUT.map((entry) => {
    const meta = EXPANSION_EVENT_META[entry.eventId];
    const participant = EXPANSION_PARTICIPANTS[entry.p];
    if (!meta) {
      throw new Error(`Missing EXPANSION_EVENT_META for ${entry.eventId}`);
    }
    if (!participant) {
      throw new Error(`Expansion participant index ${entry.p} out of range`);
    }
    counter[entry.eventId] = (counter[entry.eventId] ?? 0) + 1;
    const ord = counter[entry.eventId].toString().padStart(2, "0");
    const id = `reg-e${eventNumShort(entry.eventId)}-${ord}`;
    const { checkedIn = false, notes = null } = entry;
    const checkedInAt = checkedIn ? meta.startDate : null;
    return {
      id,
      eventId: entry.eventId,
      userId: participant.uid,
      ticketTypeId: meta.ticketTypeId,
      participantName: participant.displayName,
      participantEmail: participant.email,
      status: checkedIn ? "checked_in" : "confirmed",
      qrCodeValue: `${id}:${entry.eventId}:${participant.uid}:${seedNotBeforeBase36}:${seedNotAfterBase36}:demo-hmac-exp-${ord}`,
      checkedInAt,
      checkedInBy: checkedIn ? IDS.staffUser : null,
      notes,
      createdAt: twoWeeksAgo,
      updatedAt: checkedInAt ?? twoWeeksAgo,
    };
  });
}

/**
 * Runtime-materialised — done this way (vs a static literal) so the compact
 * `FAN_OUT` table stays the single source of truth. Re-using
 * `EXPANSION_PARTICIPANTS` + `EXPANSION_EVENT_META` keeps every seeded reg
 * consistent with the upstream user / event fixtures.
 */
const EXPANSION_REGISTRATIONS: SeedRegistration[] = materialiseExpansionRegs();

// Merge expansion event metadata into the denorm lookup used by
// writeRegistrations, so the denorm fields land on the new regs too.
for (const [id, meta] of Object.entries(EXPANSION_EVENT_META)) {
  EVENT_DENORM[id] = {
    eventTitle: meta.title,
    eventSlug: meta.slug,
    eventStartDate: meta.startDate,
    eventEndDate: meta.endDate,
  };
  TICKET_NAMES[meta.ticketTypeId] = meta.ticketTypeName;
}

async function writeRegistrations(db: Firestore): Promise<number> {
  const all = [...LEGACY_REGISTRATIONS, ...EXPANSION_REGISTRATIONS];
  await Promise.all(
    all.map((reg) =>
      db
        .collection("registrations")
        .doc(reg.id)
        .set({
          ...reg,
          ticketTypeName: TICKET_NAMES[reg.ticketTypeId] ?? null,
          ...(EVENT_DENORM[reg.eventId] ?? {}),
          accessZoneId: null,
          promotedFromWaitlistAt: null,
        }),
    ),
  );
  return all.length;
}

// ─── Badges ───────────────────────────────────────────────────────────────

async function writeBadges(db: Firestore): Promise<number> {
  const badges = [
    {
      id: "badge-001",
      registrationId: IDS.reg1,
      eventId: IDS.conference,
      userId: IDS.participant1,
      qrCodeValue: `${IDS.reg1}:${IDS.conference}:${IDS.participant1}:${seedNotBeforeBase36}:${seedNotAfterBase36}:demo-hmac-sig-001`,
    },
    {
      id: "badge-002",
      registrationId: IDS.reg2,
      eventId: IDS.conference,
      userId: IDS.participant2,
      qrCodeValue: `${IDS.reg2}:${IDS.conference}:${IDS.participant2}:${seedNotBeforeBase36}:${seedNotAfterBase36}:demo-hmac-sig-002`,
    },
  ];
  await Promise.all(
    badges.map((b) =>
      db
        .collection("badges")
        .doc(b.id)
        .set({
          ...b,
          templateId: "badge-template-001",
          pdfURL: null,
          status: "generated",
          error: null,
          downloadCount: 0,
          generatedAt: yesterday,
          createdAt: yesterday,
          updatedAt: yesterday,
        }),
    ),
  );
  return badges.length;
}

// ─── Sessions ─────────────────────────────────────────────────────────────

type SeedSession = {
  id: string;
  eventId: string;
  title: string;
  description: string;
  speakerIds: string[];
  location: string;
  startTime: string;
  endTime: string;
  tags: string[];
  streamUrl: string | null;
  isBookmarkable: boolean;
};

const LEGACY_SESSIONS: SeedSession[] = [
  {
    id: IDS.session1,
    eventId: IDS.conference,
    title: "Keynote : L'avenir de la tech en Afrique de l'Ouest",
    description:
      "Panorama des opportunités tech au Sénégal et dans la sous-région. Comment les startups africaines transforment le continent.",
    speakerIds: [IDS.speaker1],
    location: "Salle principale (CICAD)",
    startTime: inOneWeek,
    endTime: inOneWeekPlus1h,
    tags: ["keynote", "afrique", "tech"],
    streamUrl: null,
    isBookmarkable: true,
  },
  {
    id: IDS.session2,
    eventId: IDS.conference,
    title: "Atelier : Construire une API avec Fastify et TypeScript",
    description:
      "Hands-on : créer une API REST performante de zéro avec Fastify, Zod et TypeScript.",
    speakerIds: [IDS.speaker2],
    location: "Salle B",
    startTime: inOneWeekPlus1h,
    endTime: inOneWeekPlus2h,
    tags: ["atelier", "fastify", "typescript", "api"],
    streamUrl: null,
    isBookmarkable: true,
  },
  {
    id: IDS.session3,
    eventId: IDS.conference,
    title: "Table ronde : Mobile Money et inclusion financière",
    description:
      "Débat avec les acteurs de Wave, Orange Money et les fintechs locales sur l'accès aux services financiers.",
    speakerIds: [IDS.speaker1, IDS.speaker2],
    location: "Salle principale (CICAD)",
    startTime: inOneWeekPlus2h,
    endTime: inOneWeekPlus3h,
    tags: ["fintech", "mobile-money", "inclusion"],
    streamUrl: "https://meet.google.com/dts-panel-2026",
    isBookmarkable: true,
  },
  {
    id: IDS.session4,
    eventId: IDS.conference,
    title: "Networking & Cocktail de clôture",
    description:
      "Rencontrez les participants, échangez vos cartes et profitez du cocktail offert par nos sponsors.",
    speakerIds: [],
    location: "Terrasse CICAD",
    startTime: inOneWeekPlus3h,
    endTime: inOneWeekPlus4h,
    tags: ["networking"],
    streamUrl: null,
    isBookmarkable: false,
  },
];

// ─── Expansion sessions ───────────────────────────────────────────────────
// Conference-shaped events in the expansion set (hybrid / in_person
// conferences) get an agenda so the sessions view has non-empty data for
// multi-event scenarios. Sessions on purely single-stream events (concerts,
// festivals, marathons, workshops) are not modeled — those are already
// represented by a single ticket.

const EXPANSION_SESSIONS: SeedSession[] = [
  // event-010 Conférence Fintech Ouest-Africaine (hybrid, Thiès) — 3 sessions
  {
    id: "session-e10-01",
    eventId: "event-010",
    title: "Keynote : l'essor du mobile money en zone CFA",
    description:
      "État des lieux du mobile money francophone — Wave, Orange Money, Free Money, et nouveaux entrants. Panorama des régulations BCEAO.",
    speakerIds: [],
    location: "Auditorium Palais des Congrès",
    startTime: inTenDays,
    endTime: inTenDays,
    tags: ["fintech", "mobile-money", "keynote"],
    streamUrl: "https://live.thies-tech.sn/fintech-2026/keynote",
    isBookmarkable: true,
  },
  {
    id: "session-e10-02",
    eventId: "event-010",
    title: "Panel : régulations et conformité fintech BCEAO",
    description:
      "Table ronde avec des régulateurs, des juristes et des CPO de fintechs sur l'adaptation aux nouvelles exigences BCEAO.",
    speakerIds: [],
    location: "Auditorium Palais des Congrès",
    startTime: inTenDays,
    endTime: inTenDays,
    tags: ["fintech", "régulation", "bceao", "panel"],
    streamUrl: "https://live.thies-tech.sn/fintech-2026/panel-regul",
    isBookmarkable: true,
  },
  {
    id: "session-e10-03",
    eventId: "event-010",
    title: "Atelier : intégrer Wave API dans une app mobile",
    description: "Hands-on avec le SDK Wave — sandbox, callbacks, idempotency.",
    speakerIds: [],
    location: "Salle commissions",
    startTime: inTenDays,
    endTime: inTenDays,
    tags: ["wave", "api", "atelier"],
    streamUrl: null,
    isBookmarkable: true,
  },

  // event-012 Web Summit Thiès — 3 sessions (startup / dev / produit tracks)
  {
    id: "session-e12-01",
    eventId: "event-012",
    title: "Startup pitch session — dix startups sénégalaises",
    description:
      "Dix startups sélectionnées pitchent leur projet en 3 min chacune. Jury panafricain.",
    speakerIds: [],
    location: "Grande salle",
    startTime: inThreeWeeks,
    endTime: inThreeWeeks,
    tags: ["startup", "pitch", "networking"],
    streamUrl: null,
    isBookmarkable: true,
  },
  {
    id: "session-e12-02",
    eventId: "event-012",
    title: "Dev track : architectures event-driven en production",
    description:
      "Retours d'expérience sur Kafka, Pub/Sub et Firestore dans des stacks africaines à fort trafic.",
    speakerIds: [],
    location: "Salle B",
    startTime: inThreeWeeks,
    endTime: inThreeWeeks,
    tags: ["architecture", "event-driven", "backend"],
    streamUrl: null,
    isBookmarkable: true,
  },
  {
    id: "session-e12-03",
    eventId: "event-012",
    title: "Produit : research sur des marchés francophones ouest-africains",
    description:
      "Comment mener des entretiens utilisateurs pertinents dans huit pays francophones — benchmarks, biais culturels, outils.",
    speakerIds: [],
    location: "Salle C",
    startTime: inThreeWeeks,
    endTime: inThreeWeeks,
    tags: ["produit", "research", "user-research"],
    streamUrl: null,
    isBookmarkable: true,
  },

  // event-017 AfricaTech Online — 4 sessions (online-only, pan-African)
  {
    id: "session-e17-01",
    eventId: "event-017",
    title: "Opening keynote : l'écosystème tech francophone en 2026",
    description:
      "Cartographie des pôles tech en Afrique francophone — Dakar, Abidjan, Bamako, Lomé, Yaoundé.",
    speakerIds: [],
    location: "Plateforme Sonatel Live",
    startTime: inTwoMonths,
    endTime: inTwoMonths,
    tags: ["afrique", "keynote", "écosystème"],
    streamUrl: "https://live.sonatel.sn/africatech-2026/keynote",
    isBookmarkable: true,
  },
  {
    id: "session-e17-02",
    eventId: "event-017",
    title: "Deep dive : IA générative adaptée aux langues locales",
    description: "Modèles bilingues FR/Wolof/Bambara — état de l'art, datasets, benchmarks.",
    speakerIds: [],
    location: "Plateforme Sonatel Live",
    startTime: inTwoMonths,
    endTime: inTwoMonths,
    tags: ["ia", "langues-locales", "wolof", "bambara"],
    streamUrl: "https://live.sonatel.sn/africatech-2026/ia-locales",
    isBookmarkable: true,
  },
  {
    id: "session-e17-03",
    eventId: "event-017",
    title: "Studio de démos : 8 produits présentés en 45 min",
    description: "Format demo-jam — 8 équipes, 5 min chacune, vote du public.",
    speakerIds: [],
    location: "Plateforme Sonatel Live",
    startTime: inTwoMonths,
    endTime: inTwoMonths,
    tags: ["demos", "pitch", "produit"],
    streamUrl: "https://live.sonatel.sn/africatech-2026/demos",
    isBookmarkable: true,
  },
  {
    id: "session-e17-04",
    eventId: "event-017",
    title: "Closing panel : femmes et tech francophone",
    description: "Table ronde avec des fondatrices et tech leads de Dakar, Abidjan et Bamako.",
    speakerIds: [],
    location: "Plateforme Sonatel Live",
    startTime: inTwoMonths,
    endTime: inTwoMonths,
    tags: ["diversité", "leadership", "panel"],
    streamUrl: "https://live.sonatel.sn/africatech-2026/closing",
    isBookmarkable: true,
  },
];

async function writeSessions(db: Firestore): Promise<number> {
  const all = [...LEGACY_SESSIONS, ...EXPANSION_SESSIONS];
  await Promise.all(
    all.map((s) =>
      db
        .collection("sessions")
        .doc(s.id)
        .set({ ...s, createdAt: yesterday, updatedAt: yesterday }),
    ),
  );
  return all.length;
}

// ─── Speakers ─────────────────────────────────────────────────────────────

async function writeSpeakers(db: Firestore): Promise<number> {
  const speakers = [
    {
      id: IDS.speaker1,
      userId: IDS.speakerUser,
      eventId: IDS.conference,
      organizationId: IDS.orgId,
      name: "Ibrahima Gueye",
      title: "CTO @ Teranga Digital",
      company: "Teranga Digital",
      bio: "15 ans d'expérience en développement. Expert Flutter, Firebase et architectures cloud. Conférencier régulier à DakarDev et AfricaTech.",
      photoURL: null,
      socialLinks: {
        twitter: "https://twitter.com/ibragueye_dev",
        linkedin: "https://linkedin.com/in/ibrahima-gueye",
        website: "https://ibrahima.dev",
      },
      topics: ["flutter", "firebase", "cloud", "architecture"],
      sessionIds: [IDS.session1, IDS.session3],
      isConfirmed: true,
    },
    {
      id: IDS.speaker2,
      userId: null,
      eventId: IDS.conference,
      organizationId: IDS.orgId,
      name: "Marie-Claire Diouf",
      title: "Lead Developer @ Wave",
      company: "Wave",
      bio: "Ingénieure logiciel spécialisée en systèmes de paiement et APIs financières. Passionnée par l'inclusion numérique.",
      photoURL: null,
      socialLinks: {
        twitter: null,
        linkedin: "https://linkedin.com/in/mc-diouf",
        website: null,
      },
      topics: ["fintech", "api", "typescript", "payments"],
      sessionIds: [IDS.session2, IDS.session3],
      isConfirmed: true,
    },
  ];
  await Promise.all(
    speakers.map((s) =>
      db
        .collection("speakers")
        .doc(s.id)
        .set({ ...s, createdAt: yesterday, updatedAt: yesterday }),
    ),
  );
  return speakers.length;
}

// ─── Sponsors + Leads ─────────────────────────────────────────────────────

async function writeSponsors(db: Firestore): Promise<number> {
  const sponsors = [
    {
      id: IDS.sponsor1,
      userId: IDS.sponsorUser,
      eventId: IDS.conference,
      organizationId: IDS.orgId,
      companyName: "TechCorp Dakar",
      logoURL: null,
      description:
        "Leader des solutions cloud en Afrique de l'Ouest. Nous accompagnons les entreprises dans leur transformation numérique.",
      website: "https://techcorp.sn",
      tier: "gold",
      boothTitle: "Stand TechCorp — Demos Cloud",
      boothDescription: "Venez découvrir nos solutions cloud et repartez avec des goodies !",
      boothBannerURL: null,
      ctaLabel: "Découvrir nos offres",
      ctaUrl: "https://techcorp.sn/offres",
      contactName: "Aissatou Ba",
      contactEmail: "aissatou@techcorp.sn",
      contactPhone: "+221770008888",
      isActive: true,
    },
    {
      id: IDS.sponsor2,
      userId: null,
      eventId: IDS.conference,
      organizationId: IDS.orgId,
      companyName: "Orange Digital Center",
      logoURL: null,
      description: "Programme d'accompagnement des startups et développeurs par Orange Sénégal.",
      website: "https://orangedigitalcenter.sn",
      tier: "silver",
      boothTitle: "Orange Digital Center — Espace Formation",
      boothDescription: "Découvrez nos programmes de formation gratuits et nos API.",
      boothBannerURL: null,
      ctaLabel: "Rejoindre le programme",
      ctaUrl: "https://orangedigitalcenter.sn/postuler",
      contactName: "Mamadou Diallo",
      contactEmail: "mdiallo@orange.sn",
      contactPhone: "+221770006666",
      isActive: true,
    },
  ];
  await Promise.all(
    sponsors.map((s) =>
      db
        .collection("sponsors")
        .doc(s.id)
        .set({ ...s, createdAt: yesterday, updatedAt: yesterday }),
    ),
  );
  return sponsors.length;
}

async function writeSponsorLeads(db: Firestore): Promise<number> {
  await db
    .collection("sponsorLeads")
    .doc("lead-001")
    .set({
      id: "lead-001",
      sponsorId: IDS.sponsor1,
      eventId: IDS.conference,
      participantId: IDS.participant1,
      participantName: "Aminata Fall",
      participantEmail: "participant@teranga.dev",
      participantPhone: "+221770005678",
      notes: "Intéressée par notre offre startup. A demandé un devis pour l'hébergement cloud.",
      tags: ["startup", "cloud", "prospect-chaud"],
      scannedAt: oneHourAgo,
      scannedBy: IDS.sponsorUser,
    });
  return 1;
}

// ─── Payments + Receipts ──────────────────────────────────────────────────

async function writePayments(db: Firestore): Promise<number> {
  // ── payment-001 — succeeded Premium ticket on Masterclass IA (legacy) ─
  await db
    .collection("payments")
    .doc(IDS.payment1)
    .set({
      id: IDS.payment1,
      registrationId: IDS.reg6,
      eventId: IDS.paidEvent,
      organizationId: IDS.orgId,
      userId: IDS.participant2,
      amount: 35000,
      currency: "XOF",
      method: "mock",
      providerTransactionId: "mock-tx-001",
      status: "succeeded",
      redirectUrl: null,
      callbackUrl: null,
      returnUrl: "http://localhost:3002/events/masterclass-ia-generative",
      providerMetadata: { mockProvider: true },
      failureReason: null,
      refundedAmount: 0,
      initiatedAt: yesterday,
      completedAt: yesterday,
      createdAt: yesterday,
      updatedAt: yesterday,
    });
  // ── payment-002 — pending Early Bird ticket (legacy) ──────────────────
  await db.collection("payments").doc(IDS.payment2).set({
    id: IDS.payment2,
    registrationId: IDS.reg5,
    eventId: IDS.paidEvent,
    organizationId: IDS.orgId,
    userId: IDS.participant1,
    amount: 15000,
    currency: "XOF",
    method: "mock",
    providerTransactionId: "mock-tx-002",
    status: "pending",
    redirectUrl: "http://localhost:3000/v1/payments/mock-checkout/mock-tx-002",
    callbackUrl: "http://localhost:3000/v1/payments/webhook",
    returnUrl: "http://localhost:3002/events/masterclass-ia-generative",
    providerMetadata: null,
    failureReason: null,
    refundedAmount: 0,
    initiatedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  // ── payment-003 — FAILED Wave payment on event-009 formation IA ───────
  // Demonstrates the "payment failure" state with a real provider reason.
  // The registration stays in pending_payment until the user retries.
  await db
    .collection("payments")
    .doc("payment-003")
    .set({
      id: "payment-003",
      registrationId: "reg-e09-01",
      eventId: "event-009",
      organizationId: IDS.enterpriseOrgId,
      userId: EXPANSION_PARTICIPANTS[24].uid,
      amount: 75000,
      currency: "XOF",
      method: "wave",
      providerTransactionId: "wave-tx-fail-003",
      status: "failed",
      redirectUrl: null,
      callbackUrl: "http://localhost:3000/v1/payments/webhook",
      returnUrl: null,
      providerMetadata: { provider: "wave", errorCode: "INSUFFICIENT_FUNDS" },
      failureReason: "Solde Wave insuffisant — veuillez recharger votre compte.",
      refundedAmount: 0,
      initiatedAt: twoWeeksAgo,
      completedAt: twoWeeksAgo,
      createdAt: twoWeeksAgo,
      updatedAt: twoWeeksAgo,
    });
  // ── payment-004 — REFUNDED Orange Money on event-005 Festival (past) ──
  // Participant requested refund after the festival; full amount returned.
  // Shows the `refunded` state + refundedAmount > 0 on the finance dashboard.
  await db
    .collection("payments")
    .doc("payment-004")
    .set({
      id: "payment-004",
      registrationId: "reg-e05-03",
      eventId: "event-005",
      organizationId: IDS.enterpriseOrgId,
      userId: EXPANSION_PARTICIPANTS[0].uid,
      amount: 25000,
      currency: "XOF",
      method: "orange_money",
      providerTransactionId: "om-tx-refund-004",
      status: "refunded",
      redirectUrl: null,
      callbackUrl: "http://localhost:3000/v1/payments/webhook",
      returnUrl: null,
      providerMetadata: { provider: "orange_money" },
      failureReason: null,
      refundedAmount: 25000,
      initiatedAt: fortyFiveDaysAgo,
      completedAt: fortyFiveDaysAgo,
      createdAt: fortyFiveDaysAgo,
      updatedAt: oneWeekAgo,
    });
  // ── payment-005 — SUCCEEDED Orange Money on upcoming event-010 ────────
  // Gives the starter-org finance dashboard real revenue (Thiès org had
  // zero payments before). Funds are still in "pending" on the ledger
  // until event-010 completes + 7 days release window.
  await db
    .collection("payments")
    .doc("payment-005")
    .set({
      id: "payment-005",
      registrationId: "reg-e10-01",
      eventId: "event-010",
      organizationId: IDS.starterOrgId,
      userId: EXPANSION_PARTICIPANTS[13].uid,
      amount: 35000,
      currency: "XOF",
      method: "orange_money",
      providerTransactionId: "om-tx-005",
      status: "succeeded",
      redirectUrl: null,
      callbackUrl: "http://localhost:3000/v1/payments/webhook",
      returnUrl: null,
      providerMetadata: { provider: "orange_money" },
      failureReason: null,
      refundedAmount: 0,
      initiatedAt: yesterday,
      completedAt: yesterday,
      createdAt: yesterday,
      updatedAt: yesterday,
    });
  // ── payment-006 — SUCCEEDED Wave payment on PAST event-006 Marathon ───
  // Past event + funds released, so this drives the completed-payout story
  // in writePayouts (payout-002).
  await db
    .collection("payments")
    .doc("payment-006")
    .set({
      id: "payment-006",
      registrationId: "reg-e06-01",
      eventId: "event-006",
      organizationId: IDS.enterpriseOrgId,
      userId: EXPANSION_PARTICIPANTS[5].uid,
      amount: 15000,
      currency: "XOF",
      method: "wave",
      providerTransactionId: "wave-tx-006",
      status: "succeeded",
      redirectUrl: null,
      callbackUrl: "http://localhost:3000/v1/payments/webhook",
      returnUrl: null,
      providerMetadata: { provider: "wave" },
      failureReason: null,
      refundedAmount: 0,
      initiatedAt: oneMonthAgo,
      completedAt: oneMonthAgo,
      createdAt: oneMonthAgo,
      updatedAt: oneMonthAgo,
    });
  return 6;
}

async function writeReceipts(db: Firestore): Promise<number> {
  await db.collection("receipts").doc("receipt-001").set({
    id: "receipt-001",
    receiptNumber: "REC-2026-000001",
    paymentId: IDS.payment1,
    registrationId: IDS.reg6,
    eventId: IDS.paidEvent,
    organizationId: IDS.orgId,
    userId: IDS.participant2,
    amount: 35000,
    currency: "XOF",
    method: "mock",
    eventTitle: "Masterclass IA Générative",
    ticketTypeName: "Premium",
    participantName: "Ousmane Ndiaye",
    participantEmail: "participant2@teranga.dev",
    organizationName: "Teranga Events",
    issuedAt: yesterday,
    createdAt: yesterday,
  });
  // Counter doc for the receipt numbering sequence.
  await db.collection("counters").doc("receipts").set({ lastNumber: 1 });
  return 1;
}

// ─── Balance transactions (finance ledger) ────────────────────────────────
// Mirrors the derivation used by `scripts/backfill-balance-ledger.ts`:
// deterministic doc id = `backfill_` + sha256(kind|sourceId).slice(0,20).
// Seeding with the SAME id the backfill would produce makes the two writers
// converge (re-running the backfill against seeded data is a no-op), so the
// /finance page is populated as soon as the seed completes without needing
// the operator to run a separate backfill step.
//
// Currency is XOF for every seeded entry — the schema uses z.literal("XOF")
// so no other value is valid. `amount` is a signed integer: positive credits
// the org's balance (`payment`), negative debits (`platform_fee`, `payout`).

const PLATFORM_FEE_RATE = 0.05;
const FUNDS_RELEASE_DAYS = 7;

function ledgerDocId(kind: string, sourceId: string): string {
  const hash = createHash("sha256").update(`${kind}|${sourceId}`).digest("hex");
  return `backfill_${hash.slice(0, 20)}`;
}

function computeAvailableOn(paymentCompletedAt: string, eventEndDate: string): string {
  return new Date(new Date(eventEndDate).getTime() + FUNDS_RELEASE_DAYS * 86_400_000).toISOString();
}

async function writeBalanceTransactions(db: Firestore): Promise<number> {
  // The seed has exactly one succeeded payment (`payment-001`) — a 35 000
  // XOF Premium ticket to the Masterclass IA (event-004). The event's
  // endDate equals `inTwoWeeks` so the release window lands ~21 days out;
  // the targetStatus rule mirrors the backfill: `available` if the release
  // date is already in the past, else `pending`.
  const paymentAmount = 35000;
  const feeAmount = Math.round(paymentAmount * PLATFORM_FEE_RATE); // 1750 XOF
  const eventEndDate = Dates.inTwoWeeks;
  const completedAt = yesterday;
  const availableOn = computeAvailableOn(completedAt, eventEndDate);
  const targetStatus: "pending" | "available" =
    new Date(availableOn).getTime() <= Date.now() ? "available" : "pending";

  const paymentId = IDS.payment1;
  const paymentDocId = ledgerDocId("payment", paymentId);
  const feeDocId = ledgerDocId("platform_fee", paymentId);

  const entries = [
    {
      id: paymentDocId,
      organizationId: IDS.orgId,
      eventId: IDS.paidEvent,
      paymentId,
      payoutId: null,
      kind: "payment" as const,
      amount: paymentAmount,
      currency: "XOF" as const,
      status: targetStatus,
      availableOn,
      description: "Billet (seed)",
      createdBy: "system:seed",
      createdAt: completedAt,
    },
    {
      id: feeDocId,
      organizationId: IDS.orgId,
      eventId: IDS.paidEvent,
      paymentId,
      payoutId: null,
      kind: "platform_fee" as const,
      amount: -feeAmount,
      currency: "XOF" as const,
      status: targetStatus,
      availableOn,
      description: `Frais plateforme (seed, ${Math.round(PLATFORM_FEE_RATE * 100)}%)`,
      createdBy: "system:seed",
      createdAt: completedAt,
    },
  ];

  // ── Expansion ledger entries (Phase 5) ────────────────────────────────
  // Mirror `writePayments` additions: 4 new payments land in the ledger.
  // payment-003 FAILED → no ledger entry (matches service-layer behaviour).
  // payment-004 REFUNDED → original payment + fee entries + refund reversal.
  // payment-005 SUCCEEDED (upcoming event) → pending availability.
  // payment-006 SUCCEEDED (past + paid out) → status=paid_out, see payout-002.

  const expansionEntries: Array<{
    id: string;
    organizationId: string;
    eventId: string;
    paymentId: string | null;
    payoutId: string | null;
    kind: "payment" | "platform_fee" | "payout" | "refund";
    amount: number;
    currency: "XOF";
    status: "pending" | "available" | "paid_out";
    availableOn: string;
    description: string;
    createdBy: string;
    createdAt: string;
  }> = [];

  // payment-004 refunded — record the original credit + fee + refund debit
  const p004Fee = Math.round(25000 * PLATFORM_FEE_RATE);
  expansionEntries.push(
    {
      id: ledgerDocId("payment", "payment-004"),
      organizationId: IDS.enterpriseOrgId,
      eventId: "event-005",
      paymentId: "payment-004",
      payoutId: null,
      kind: "payment",
      amount: 25000,
      currency: "XOF",
      status: "available",
      availableOn: Dates.oneMonthAgo,
      description: "Billet festival Saly — remboursé",
      createdBy: "system:seed",
      createdAt: Dates.fortyFiveDaysAgo,
    },
    {
      id: ledgerDocId("platform_fee", "payment-004"),
      organizationId: IDS.enterpriseOrgId,
      eventId: "event-005",
      paymentId: "payment-004",
      payoutId: null,
      kind: "platform_fee",
      amount: -p004Fee,
      currency: "XOF",
      status: "available",
      availableOn: Dates.oneMonthAgo,
      description: "Frais plateforme (annulé par remboursement)",
      createdBy: "system:seed",
      createdAt: Dates.fortyFiveDaysAgo,
    },
    {
      id: ledgerDocId("refund", "payment-004"),
      organizationId: IDS.enterpriseOrgId,
      eventId: "event-005",
      paymentId: "payment-004",
      payoutId: null,
      kind: "refund",
      amount: -25000,
      currency: "XOF",
      status: "available",
      availableOn: Dates.oneWeekAgo,
      description: "Remboursement intégral Orange Money",
      createdBy: "system:seed",
      createdAt: Dates.oneWeekAgo,
    },
  );

  // payment-005 succeeded on upcoming event-010 — still pending
  const p005Fee = Math.round(35000 * PLATFORM_FEE_RATE);
  const p005AvailableOn = computeAvailableOn(Dates.yesterday, Dates.inTenDays);
  expansionEntries.push(
    {
      id: ledgerDocId("payment", "payment-005"),
      organizationId: IDS.starterOrgId,
      eventId: "event-010",
      paymentId: "payment-005",
      payoutId: null,
      kind: "payment",
      amount: 35000,
      currency: "XOF",
      status: "pending",
      availableOn: p005AvailableOn,
      description: "Billet Fintech Thiès (seed)",
      createdBy: "system:seed",
      createdAt: Dates.yesterday,
    },
    {
      id: ledgerDocId("platform_fee", "payment-005"),
      organizationId: IDS.starterOrgId,
      eventId: "event-010",
      paymentId: "payment-005",
      payoutId: null,
      kind: "platform_fee",
      amount: -p005Fee,
      currency: "XOF",
      status: "pending",
      availableOn: p005AvailableOn,
      description: `Frais plateforme (seed, ${Math.round(PLATFORM_FEE_RATE * 100)}%)`,
      createdBy: "system:seed",
      createdAt: Dates.yesterday,
    },
  );

  // payment-006 succeeded + paid out (past marathon event-006)
  const p006Fee = Math.round(15000 * PLATFORM_FEE_RATE);
  expansionEntries.push(
    {
      id: ledgerDocId("payment", "payment-006"),
      organizationId: IDS.enterpriseOrgId,
      eventId: "event-006",
      paymentId: "payment-006",
      payoutId: "payout-002",
      kind: "payment",
      amount: 15000,
      currency: "XOF",
      status: "paid_out",
      availableOn: Dates.twoWeeksAgo,
      description: "Billet marathon Dakar (seed)",
      createdBy: "system:seed",
      createdAt: Dates.oneMonthAgo,
    },
    {
      id: ledgerDocId("platform_fee", "payment-006"),
      organizationId: IDS.enterpriseOrgId,
      eventId: "event-006",
      paymentId: "payment-006",
      payoutId: "payout-002",
      kind: "platform_fee",
      amount: -p006Fee,
      currency: "XOF",
      status: "paid_out",
      availableOn: Dates.twoWeeksAgo,
      description: `Frais plateforme (seed, ${Math.round(PLATFORM_FEE_RATE * 100)}%)`,
      createdBy: "system:seed",
      createdAt: Dates.oneMonthAgo,
    },
  );

  await Promise.all(entries.map((e) => db.collection("balanceTransactions").doc(e.id).set(e)));
  await Promise.all(
    expansionEntries.map((e) => db.collection("balanceTransactions").doc(e.id).set(e)),
  );
  return entries.length + expansionEntries.length;
}

// ─── Payouts (with linked ledger entry) ───────────────────────────────────
// One pending payout for the pro-plan org (org-001), covering the lifetime
// succeeded payment (`payment-001`) on event-004. Amounts mirror the
// `platformFeeRate` used by the ledger. A matching `payout` kind entry in
// `balanceTransactions` is written so the /finance page shows the debit.

async function writePayouts(db: Firestore): Promise<number> {
  const totalAmount = 35000;
  const platformFee = Math.round(totalAmount * PLATFORM_FEE_RATE); // 1750
  const netAmount = totalAmount - platformFee; // 33 250

  // Schedule the payout for 7 days after the paid event's end — matches
  // the FUNDS_RELEASE_DAYS convention and keeps seed timelines coherent.
  const scheduledFor = new Date(
    new Date(Dates.inTwoWeeks).getTime() + FUNDS_RELEASE_DAYS * 86_400_000,
  ).toISOString();

  const payoutId = "payout-001";
  await db
    .collection("payouts")
    .doc(payoutId)
    .set({
      id: payoutId,
      organizationId: IDS.orgId,
      eventId: IDS.paidEvent,
      totalAmount,
      platformFee,
      platformFeeRate: PLATFORM_FEE_RATE,
      netAmount,
      status: "pending",
      paymentIds: [IDS.payment1],
      periodFrom: Dates.twoWeeksAgo,
      periodTo: scheduledFor,
      completedAt: null,
      // Custom (non-schema) convenience fields used by the /finance UI for
      // the "scheduled payout" card. Zod schema extra-key tolerance is the
      // default behavior for PayoutSchema (no `.strict()`).
      scheduledFor,
      currency: "XOF",
      amountMinor: netAmount, // XOF has no decimals — minor = major
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  // Matching debit entry in the ledger so the /finance page's "paid_out"
  // section isn't empty. Status stays `pending` while the payout is
  // pending — the payout-creation service flips it to `paid_out` on
  // completion.
  const payoutLedgerDocId = ledgerDocId("payout", payoutId);
  await db.collection("balanceTransactions").doc(payoutLedgerDocId).set({
    id: payoutLedgerDocId,
    organizationId: IDS.orgId,
    eventId: IDS.paidEvent,
    paymentId: null,
    payoutId,
    kind: "payout",
    amount: -netAmount,
    currency: "XOF",
    status: "pending",
    availableOn: scheduledFor,
    description: "Versement planifié (seed)",
    createdBy: "system:seed",
    createdAt: yesterday,
  });

  // ── payout-002 — COMPLETED payout on past event-006 (enterprise org) ──
  // Paired with payment-006 (15 000 XOF Wave) in the ledger. Status is
  // `completed` with a completedAt timestamp so the finance dashboard
  // shows one historical payout alongside the pending one.
  const p2Total = 15000;
  const p2Fee = Math.round(p2Total * PLATFORM_FEE_RATE);
  const p2Net = p2Total - p2Fee;
  await db
    .collection("payouts")
    .doc("payout-002")
    .set({
      id: "payout-002",
      organizationId: IDS.enterpriseOrgId,
      eventId: "event-006",
      totalAmount: p2Total,
      platformFee: p2Fee,
      platformFeeRate: PLATFORM_FEE_RATE,
      netAmount: p2Net,
      status: "completed",
      paymentIds: ["payment-006"],
      periodFrom: Dates.oneMonthAgo,
      periodTo: Dates.twoWeeksAgo,
      completedAt: Dates.twoWeeksAgo,
      scheduledFor: Dates.twoWeeksAgo,
      currency: "XOF",
      amountMinor: p2Net,
      createdAt: Dates.oneMonthAgo,
      updatedAt: Dates.twoWeeksAgo,
    });

  // Matching completed payout ledger entry.
  const p2LedgerDocId = ledgerDocId("payout", "payout-002");
  await db.collection("balanceTransactions").doc(p2LedgerDocId).set({
    id: p2LedgerDocId,
    organizationId: IDS.enterpriseOrgId,
    eventId: "event-006",
    paymentId: null,
    payoutId: "payout-002",
    kind: "payout",
    amount: -p2Net,
    currency: "XOF",
    status: "paid_out",
    availableOn: Dates.twoWeeksAgo,
    description: "Versement effectué (seed)",
    createdBy: "system:seed",
    createdAt: Dates.twoWeeksAgo,
  });

  return 2;
}

// ─── Promo codes ──────────────────────────────────────────────────────────
// Three promo codes exercise every branch of the promo-code UI: an active
// percentage code, an expired fixed-XOF code, and a single-use 100% promo
// scoped to the enterprise org's free event so e2e tests can exercise the
// "free registration via promo" path.

async function writePromoCodes(db: Firestore): Promise<number> {
  const expiresInOneMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const expiredYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const promos = [
    {
      id: "promo-001",
      eventId: IDS.paidEvent,
      organizationId: IDS.orgId,
      code: "TERANGA10",
      discountType: "percentage" as const,
      discountValue: 10,
      maxUses: null,
      // 5 participants have redeemed the 10% code on the Masterclass.
      // `paymentRedemptions-001..005` on the finance dashboard carry this.
      usedCount: 5,
      expiresAt: expiresInOneMonth,
      ticketTypeIds: [],
      isActive: true,
      createdBy: IDS.organizer,
      createdAt: yesterday,
      updatedAt: yesterday,
    },
    {
      id: "promo-002",
      eventId: IDS.paidEvent,
      organizationId: IDS.orgId,
      code: "EARLYBIRD",
      discountType: "fixed" as const,
      discountValue: 5000,
      maxUses: 50,
      usedCount: 12,
      expiresAt: expiredYesterday,
      ticketTypeIds: ["ticket-standard-004"],
      isActive: true, // active flag stays true; expiresAt gates usage
      createdBy: IDS.organizer,
      createdAt: twoWeeksAgo,
      updatedAt: twoWeeksAgo,
    },
    {
      id: "promo-003",
      eventId: "event-017", // AfricaTech Online (enterprise org)
      organizationId: IDS.enterpriseOrgId,
      code: "STAFF100",
      discountType: "percentage" as const,
      discountValue: 100,
      maxUses: 1,
      // Single-use code already redeemed; the UI should show "Épuisé".
      usedCount: 1,
      expiresAt: expiresInOneMonth,
      ticketTypeIds: [],
      isActive: true,
      createdBy: IDS.enterpriseOrganizer,
      createdAt: yesterday,
      updatedAt: yesterday,
    },
  ];

  await Promise.all(promos.map((p) => db.collection("promoCodes").doc(p.id).set(p)));
  return promos.length;
}

// ─── Badge templates ──────────────────────────────────────────────────────
// Two templates covering the canonical shapes operators pick between: a
// minimal QR-only card (default for every event on the pro org) and a
// branded photo card (starter org's venue org). `isDefault: true` on the
// first so the Event → Badges page has a pre-picked option on first load.

async function writeBadgeTemplates(db: Firestore): Promise<number> {
  const templates = [
    {
      id: "badge-template-001",
      organizationId: IDS.orgId,
      name: "QR Only — standard",
      width: 85.6,
      height: 54.0,
      backgroundColor: "#FFFFFF",
      primaryColor: "#1A1A2E",
      logoURL: null,
      showQR: true,
      showName: true,
      showOrganization: true,
      showRole: false,
      showPhoto: false,
      customFields: [],
      isDefault: true,
      createdAt: yesterday,
      updatedAt: yesterday,
    },
    {
      id: "badge-template-002",
      organizationId: IDS.venueOrgId,
      name: "Photo Badge — Dakar Venues",
      width: 85.6,
      height: 54.0,
      backgroundColor: "#F5F3EF",
      primaryColor: "#D4A017", // teranga-gold
      logoURL: null,
      showQR: true,
      showName: true,
      showOrganization: true,
      showRole: true,
      showPhoto: true,
      customFields: [
        {
          key: "accessZone",
          label: "Zone",
          position: { x: 10, y: 45 },
          fontSize: 10,
          color: "#1A1A2E",
        },
      ],
      isDefault: false,
      createdAt: yesterday,
      updatedAt: yesterday,
    },
  ];

  await Promise.all(templates.map((t) => db.collection("badgeTemplates").doc(t.id).set(t)));
  return templates.length;
}

// ─── Session bookmarks ────────────────────────────────────────────────────
// Participants can bookmark individual sessions from the schedule page. The
// collection was never seeded, so the "My agenda" list on web-participant
// was permanently empty. Seed ~15 bookmarks across the three events that
// carry the bulk of sessions (event-010 Fintech, event-012 offline AI, and
// event-017 AfricaTech Online). Targets pin events a realistic participant
// would care about — keynote + one deep-dive + the networking session.

async function writeSessionBookmarks(db: Firestore): Promise<number> {
  const bookmarks: Array<{
    id: string;
    sessionId: string;
    eventId: string;
    userId: string;
  }> = [
    // event-010 Fintech Ouest-Africaine (Thiès, in 10 days)
    {
      id: "bookmark-001",
      sessionId: "session-e10-01",
      eventId: "event-010",
      userId: IDS.participant1,
    },
    {
      id: "bookmark-002",
      sessionId: "session-e10-02",
      eventId: "event-010",
      userId: IDS.participant1,
    },
    {
      id: "bookmark-003",
      sessionId: "session-e10-01",
      eventId: "event-010",
      userId: IDS.participant2,
    },
    {
      id: "bookmark-004",
      sessionId: "session-e10-03",
      eventId: "event-010",
      userId: EXPANSION_PARTICIPANTS[0].uid,
    },
    {
      id: "bookmark-005",
      sessionId: "session-e10-01",
      eventId: "event-010",
      userId: EXPANSION_PARTICIPANTS[13].uid,
    },
    // event-012 Offline AI Workshop (Saint-Louis, in 2 weeks)
    {
      id: "bookmark-006",
      sessionId: "session-e12-01",
      eventId: "event-012",
      userId: IDS.participant1,
    },
    {
      id: "bookmark-007",
      sessionId: "session-e12-02",
      eventId: "event-012",
      userId: IDS.participant2,
    },
    {
      id: "bookmark-008",
      sessionId: "session-e12-03",
      eventId: "event-012",
      userId: EXPANSION_PARTICIPANTS[16].uid,
    },
    // event-017 AfricaTech Online (hybrid enterprise)
    {
      id: "bookmark-009",
      sessionId: "session-e17-01",
      eventId: "event-017",
      userId: IDS.participant1,
    },
    {
      id: "bookmark-010",
      sessionId: "session-e17-01",
      eventId: "event-017",
      userId: IDS.participant2,
    },
    {
      id: "bookmark-011",
      sessionId: "session-e17-02",
      eventId: "event-017",
      userId: IDS.organizer,
    },
    {
      id: "bookmark-012",
      sessionId: "session-e17-03",
      eventId: "event-017",
      userId: EXPANSION_PARTICIPANTS[2].uid,
    },
    {
      id: "bookmark-013",
      sessionId: "session-e17-04",
      eventId: "event-017",
      userId: EXPANSION_PARTICIPANTS[12].uid,
    },
    // Legacy conference — IDS.session1 (keynote)
    {
      id: "bookmark-014",
      sessionId: IDS.session1,
      eventId: IDS.conference,
      userId: IDS.participant1,
    },
    {
      id: "bookmark-015",
      sessionId: IDS.session1,
      eventId: IDS.conference,
      userId: IDS.participant2,
    },
  ];

  await Promise.all(
    bookmarks.map((b) =>
      db
        .collection("sessionBookmarks")
        .doc(b.id)
        .set({ ...b, createdAt: yesterday }),
    ),
  );
  return bookmarks.length;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export type ActivityCounts = {
  registrations: number;
  badges: number;
  sessions: number;
  sessionBookmarks: number;
  speakers: number;
  sponsors: number;
  sponsorLeads: number;
  payments: number;
  receipts: number;
  balanceTransactions: number;
  payouts: number;
  promoCodes: number;
  badgeTemplates: number;
};

export async function seedActivity(db: Firestore): Promise<ActivityCounts> {
  // Registrations + badges must land before anything else that references
  // them. Everything else in this module can be fanned out in parallel.
  const [registrations, badges] = await Promise.all([writeRegistrations(db), writeBadges(db)]);
  const [
    sessions,
    speakers,
    sponsors,
    sponsorLeads,
    payments,
    receipts,
    promoCodes,
    badgeTemplates,
  ] = await Promise.all([
    writeSessions(db),
    writeSpeakers(db),
    writeSponsors(db),
    writeSponsorLeads(db),
    writePayments(db),
    writeReceipts(db),
    writePromoCodes(db),
    writeBadgeTemplates(db),
  ]);
  // Session bookmarks must come after sessions are written so the
  // `sessionId` foreign key is valid when the read-path resolves it.
  const sessionBookmarks = await writeSessionBookmarks(db);
  // Ledger entries depend on `writePayments` having landed so the paymentId
  // they reference exists; payouts in turn flip ledger rows, so they follow.
  const balanceTransactions = await writeBalanceTransactions(db);
  const payouts = await writePayouts(db);
  return {
    registrations,
    badges,
    sessions,
    sessionBookmarks,
    speakers,
    sponsors,
    sponsorLeads,
    payments,
    receipts,
    // +1 payout-001 ledger entry + 1 payout-002 ledger entry are written
    // inside writePayouts but not counted by writeBalanceTransactions's
    // return value. Sum them here for an accurate log line.
    balanceTransactions: balanceTransactions + 2,
    payouts,
    promoCodes,
    badgeTemplates,
  };
}
