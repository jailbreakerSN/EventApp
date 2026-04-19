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

const {
  now,
  oneHourAgo,
  yesterday,
  inOneWeek,
  inOneWeekPlus1h,
  inOneWeekPlus2h,
  inOneWeekPlus3h,
  inOneWeekPlus4h,
  inTwoWeeks,
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

// Populated by PR C part 2 — registrations fanned out across event-005..020.
const EXPANSION_REGISTRATIONS: SeedRegistration[] = [];

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

// Populated by PR C part 2 — additional sessions for expansion conferences.
const EXPANSION_SESSIONS: SeedSession[] = [];

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
