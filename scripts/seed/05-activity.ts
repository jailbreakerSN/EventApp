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

import type { Firestore } from "firebase-admin/firestore";

import { Dates } from "./config";
import { IDS } from "./ids";
import { EXPANSION_PARTICIPANTS } from "./02-users";
import { EXPANSION_EVENT_DENORM, findTicketType } from "./04-events";

const {
  now,
  oneHourAgo,
  yesterday,
  twoWeeksAgo,
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

// Shared across registrations + badges. The epoch is only used as a replay-
// detection anchor on the QR payload — in the seed we fix it at start-up so
// every re-seed produces the same QR for a given registration.
const epochBase36 = Date.now().toString(36);

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
    qrCodeValue: `${IDS.reg1}:${IDS.conference}:${IDS.participant1}:${epochBase36}:demo-hmac-sig-001`,
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
    qrCodeValue: `${IDS.reg2}:${IDS.conference}:${IDS.participant2}:${epochBase36}:demo-hmac-sig-002`,
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
    qrCodeValue: `${IDS.reg3}:${IDS.conference}:${IDS.speakerUser}:${epochBase36}:demo-hmac-sig-003`,
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
    qrCodeValue: `${IDS.reg4}:${IDS.conference}:${IDS.sponsorUser}:${epochBase36}:demo-hmac-sig-004`,
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
    qrCodeValue: `${IDS.reg6}:${IDS.paidEvent}:${IDS.participant2}:${epochBase36}:demo-hmac-sig-006`,
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
      qrCodeValue: `${id}:${entry.eventId}:${participant.uid}:${epochBase36}:demo-hmac-exp-${ord}`,
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
      qrCodeValue: `${IDS.reg1}:${IDS.conference}:${IDS.participant1}:${epochBase36}:demo-hmac-sig-001`,
    },
    {
      id: "badge-002",
      registrationId: IDS.reg2,
      eventId: IDS.conference,
      userId: IDS.participant2,
      qrCodeValue: `${IDS.reg2}:${IDS.conference}:${IDS.participant2}:${epochBase36}:demo-hmac-sig-002`,
    },
  ];
  await Promise.all(
    badges.map((b) =>
      db
        .collection("badges")
        .doc(b.id)
        .set({
          ...b,
          templateId: null,
          pdfURL: null,
          status: "generated",
          error: null,
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
  return 2;
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

// ─── Orchestrator ─────────────────────────────────────────────────────────

export type ActivityCounts = {
  registrations: number;
  badges: number;
  sessions: number;
  speakers: number;
  sponsors: number;
  sponsorLeads: number;
  payments: number;
  receipts: number;
};

export async function seedActivity(db: Firestore): Promise<ActivityCounts> {
  // Registrations + badges must land before anything else that references
  // them. Everything else in this module can be fanned out in parallel.
  const [registrations, badges] = await Promise.all([writeRegistrations(db), writeBadges(db)]);
  const [sessions, speakers, sponsors, sponsorLeads, payments, receipts] = await Promise.all([
    writeSessions(db),
    writeSpeakers(db),
    writeSponsors(db),
    writeSponsorLeads(db),
    writePayments(db),
    writeReceipts(db),
  ]);
  return {
    registrations,
    badges,
    sessions,
    speakers,
    sponsors,
    sponsorLeads,
    payments,
    receipts,
  };
}
