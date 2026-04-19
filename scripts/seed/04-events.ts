/**
 * Seed event fixtures — 20 events across categories / formats / plans / cities.
 *
 * The four legacy events (event-001..004) are preserved BYTE-FOR-BYTE because
 * downstream inline sections in `seed-emulators.ts` (registrations, sessions,
 * speakers, feed, payments, broadcasts, audit logs) all reference them by the
 * IDs resolved through `./ids`. Touching any field on the legacy four risks a
 * silent cascade failure somewhere in sections 5-20.
 *
 * The 16 expansion events (event-005..020) are added by subsequent commits in
 * this PR and cover:
 *   - every EventCategory value except `other` / `ceremony`
 *   - all three EventFormat values (in_person / online / hybrid)
 *   - all lifecycle states (past completed, live now, near-term, far-future)
 *   - all four plan tiers — free / starter / pro / enterprise
 *   - 8 francophone West African cities
 *
 * This first commit lands the module scaffolding + the 4 legacy events so the
 * orchestrator rewire can import `seedEvents` while the remaining events are
 * filled in. `seedEvents` returns `all.length` so the caller can log totals.
 */

import type { Firestore } from "firebase-admin/firestore";

import { Dates } from "./config";
import { IDS } from "./ids";

const {
  now,
  twoHoursAgo,
  oneHourAgo,
  yesterday,
  twoDaysAgo,
  oneWeekAgo,
  twoWeeksAgo,
  oneMonthAgo,
  fortyFiveDaysAgo,
  threeMonthsAgo,
  inThreeHours,
  inFourHours,
  inOneWeek,
  inTwoWeeks,
  inOneMonth,
} = Dates;

/**
 * Shape we actually write to Firestore. Kept loose (not z.infer<EventSchema>)
 * because the seed writes denormalised fields that the Zod schema marks as
 * optional — forcing the full inferred type here would trigger spurious
 * `undefined` vs `null` friction on re-seed.
 */
type SeedEvent = Record<string, unknown> & { id: string };

// ─── Legacy events (preserved byte-for-byte) ─────────────────────────────
// ⚠ DO NOT EDIT fields on these four. They are the anchor for every inline
// fixture in `seed-emulators.ts` (registrations, sessions, feed posts,
// comments, payments, receipts, broadcasts, audit logs). If you need to
// change shape, update the monolith AND the matching inline references in
// one atomic commit.

const LEGACY_EVENTS: SeedEvent[] = [
  // Event 1: Published FREE conference (main event for testing most features)
  {
    id: IDS.conference,
    organizationId: IDS.orgId,
    title: "Dakar Tech Summit 2026",
    slug: "dakar-tech-summit-2026",
    description:
      "Le plus grand événement tech d'Afrique de l'Ouest. Rejoignez-nous pour deux jours de conférences, ateliers et networking avec les meilleurs talents tech du continent.",
    shortDescription: "Le rendez-vous tech incontournable de Dakar",
    coverImageURL: null,
    bannerImageURL: null,
    category: "conference",
    tags: ["tech", "startup", "dakar", "innovation"],
    format: "in_person",
    status: "published",
    location: {
      name: "Centre International de Conférences de Dakar (CICAD)",
      address: "Route de King Fahd, Almadies",
      city: "Dakar",
      country: "SN",
    },
    startDate: inOneWeek,
    endDate: inTwoWeeks,
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "ticket-standard-001",
        name: "Standard",
        description: "Accès aux conférences et networking",
        price: 0,
        currency: "XOF",
        totalQuantity: 500,
        soldCount: 4,
        accessZoneIds: [],
        isVisible: true,
      },
      {
        id: "ticket-vip-001",
        name: "VIP",
        description: "Accès complet + déjeuner + places réservées",
        price: 25000,
        currency: "XOF",
        totalQuantity: 50,
        soldCount: 1,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: 550,
    registeredCount: 5,
    checkedInCount: 1,
    isPublic: true,
    isFeatured: true,
    venueId: IDS.venue1,
    venueName: "CICAD — Centre International de Conferences",
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.organizer,
    updatedBy: IDS.organizer,
    createdAt: twoDaysAgo,
    updatedAt: now,
    publishedAt: yesterday,
  },

  // Event 2: Draft workshop (paid)
  {
    id: IDS.workshop,
    organizationId: IDS.orgId,
    title: "Atelier Flutter & Firebase",
    slug: "atelier-flutter-firebase",
    description:
      "Un atelier pratique de 4 heures pour apprendre à construire une application mobile avec Flutter et Firebase. Apportez votre ordinateur !",
    shortDescription: "Atelier pratique Flutter + Firebase",
    coverImageURL: null,
    bannerImageURL: null,
    category: "workshop",
    tags: ["flutter", "firebase", "mobile", "formation"],
    format: "in_person",
    status: "draft",
    location: {
      name: "Jokkolabs Dakar",
      address: "Sicap Liberté 6, Villa 7691",
      city: "Dakar",
      country: "SN",
    },
    startDate: inOneMonth,
    endDate: inOneMonth,
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "ticket-standard-002",
        name: "Participant",
        description: "Place atelier",
        price: 5000,
        currency: "XOF",
        totalQuantity: 30,
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: 30,
    registeredCount: 0,
    checkedInCount: 0,
    isPublic: true,
    isFeatured: false,
    venueId: null,
    venueName: null,
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.organizer,
    updatedBy: IDS.organizer,
    createdAt: yesterday,
    updatedAt: yesterday,
    publishedAt: null,
  },

  // Event 3: Cancelled meetup
  {
    id: IDS.meetup,
    organizationId: IDS.orgId,
    title: "Meetup Développeurs Dakar #12",
    slug: "meetup-dev-dakar-12",
    description:
      "Rencontre mensuelle des développeurs de Dakar. Présentations éclair et networking.",
    shortDescription: "Meetup mensuel dev Dakar",
    coverImageURL: null,
    bannerImageURL: null,
    category: "networking",
    tags: ["meetup", "dev", "dakar"],
    format: "hybrid",
    status: "cancelled",
    location: {
      name: "Impact Hub Dakar",
      address: "Rue Carnot x Amadou Assane Ndoye",
      city: "Dakar",
      country: "SN",
      streamUrl: "https://meet.google.com/abc-defg-hij",
    },
    startDate: yesterday,
    endDate: yesterday,
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "ticket-standard-003",
        name: "Entrée libre",
        price: 0,
        currency: "XOF",
        totalQuantity: null,
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: null,
    registeredCount: 0,
    checkedInCount: 0,
    isPublic: true,
    isFeatured: false,
    venueId: null,
    venueName: null,
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.organizer,
    updatedBy: IDS.organizer,
    createdAt: twoDaysAgo,
    updatedAt: yesterday,
    publishedAt: twoDaysAgo,
  },

  // Event 4: Published PAID event (for testing payment flow)
  {
    id: IDS.paidEvent,
    organizationId: IDS.orgId,
    title: "Masterclass IA Générative",
    slug: "masterclass-ia-generative",
    description:
      "Une journée intensive pour maîtriser les outils d'IA générative : ChatGPT, Claude, Midjourney et leurs applications business en Afrique.",
    shortDescription: "Maîtrisez l'IA générative en une journée",
    coverImageURL: null,
    bannerImageURL: null,
    category: "conference",
    tags: ["ia", "ai", "generative", "business", "dakar"],
    format: "in_person",
    status: "published",
    location: {
      name: "Radisson Blu Dakar",
      address: "Route de la Corniche, Sea Plaza",
      city: "Dakar",
      country: "SN",
    },
    startDate: inTwoWeeks,
    endDate: inTwoWeeks,
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "ticket-standard-004",
        name: "Early Bird",
        description: "Tarif réduit — places limitées",
        price: 15000,
        currency: "XOF",
        totalQuantity: 50,
        soldCount: 1,
        accessZoneIds: [],
        isVisible: true,
      },
      {
        id: "ticket-vip-004",
        name: "Premium",
        description: "Accès complet + déjeuner VIP + certificat",
        price: 35000,
        currency: "XOF",
        totalQuantity: 20,
        soldCount: 1,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: 70,
    registeredCount: 2,
    checkedInCount: 0,
    isPublic: true,
    isFeatured: true,
    venueId: IDS.venue2,
    venueName: "Radisson Blu Dakar Sea Plaza",
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.organizer,
    updatedBy: IDS.organizer,
    createdAt: yesterday,
    updatedAt: now,
    publishedAt: now,
  },
];

// ─── Expansion events ──────────────────────────────────────────────────
// Organised by lifecycle bucket (past → live → near-term → far-future) so
// the seed produces realistic distribution across the `upcoming / live /
// past` filter surfaces in the participant app and admin dashboards.

const PAST_EVENTS: SeedEvent[] = [
  // event-005 — Past / completed festival. Exercises the `completed` status
  // badge on the events list + venue-006 (Saly beach hotel) activity counter.
  {
    id: "event-005",
    organizationId: IDS.enterpriseOrgId,
    title: "Festival Hip-Hop de Saly",
    slug: "festival-hip-hop-saly-2026",
    description:
      "Trois jours de hip-hop francophone sur la plage de Saly. Line-up pan-africain — Sénégal, Côte d'Ivoire, Mali, Togo — avec masterclass beatmaking et open mic.",
    shortDescription: "Festival hip-hop pan-africain sur la plage de Saly",
    coverImageURL: null,
    bannerImageURL: null,
    category: "festival",
    tags: ["festival", "hip-hop", "musique", "saly", "afrique"],
    format: "in_person",
    status: "completed",
    location: {
      name: "Palm Beach Resort Saly",
      address: "Route de la Pointe, Saly Portudal",
      city: "Saly",
      country: "SN",
    },
    startDate: fortyFiveDaysAgo,
    endDate: fortyFiveDaysAgo, // modelled as a single-ISO range; visually a 3-day fest
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "ticket-pass-005",
        name: "Pass 3 jours",
        description: "Accès complet aux trois jours + backstage",
        price: 25000,
        currency: "XOF",
        totalQuantity: 2000,
        soldCount: 1850,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: 2000,
    registeredCount: 1850,
    checkedInCount: 1624,
    isPublic: true,
    isFeatured: false,
    venueId: "venue-006",
    venueName: "Palm Beach Resort Saly",
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.enterpriseOrganizer,
    updatedBy: IDS.enterpriseOrganizer,
    createdAt: oneMonthAgo,
    updatedAt: fortyFiveDaysAgo,
    publishedAt: oneMonthAgo,
  },

  // event-006 — Past / completed sport event. Uses venue-005 (outdoor
  // Monument de la Renaissance) so the venue profile shows real event history.
  {
    id: "event-006",
    organizationId: IDS.enterpriseOrgId,
    title: "Marathon de Dakar 2026",
    slug: "marathon-dakar-2026",
    description:
      "Le marathon annuel de Dakar — 42,195 km au cœur de la capitale sénégalaise. Parcours certifié, 5 000 coureurs attendus, tracé Almadies → Corniche → Monument de la Renaissance.",
    shortDescription: "Marathon international de Dakar, 42 km",
    coverImageURL: null,
    bannerImageURL: null,
    category: "sport",
    tags: ["sport", "marathon", "course", "dakar"],
    format: "in_person",
    status: "completed",
    location: {
      name: "Esplanade Monument de la Renaissance",
      address: "Colline des Mamelles, Ouakam",
      city: "Dakar",
      country: "SN",
    },
    startDate: oneMonthAgo,
    endDate: oneMonthAgo,
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "ticket-marathon-006",
        name: "Dossard marathon",
        description: "Dossard officiel + t-shirt + ravitaillement",
        price: 15000,
        currency: "XOF",
        totalQuantity: 5000,
        soldCount: 4200,
        accessZoneIds: [],
        isVisible: true,
      },
      {
        id: "ticket-semi-006",
        name: "Dossard semi-marathon",
        description: "Parcours 21 km",
        price: 10000,
        currency: "XOF",
        totalQuantity: 3000,
        soldCount: 2800,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: 8000,
    registeredCount: 7000,
    checkedInCount: 6312,
    isPublic: true,
    isFeatured: false,
    venueId: "venue-005",
    venueName: "Esplanade Monument de la Renaissance",
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.enterpriseOrganizer,
    updatedBy: IDS.enterpriseOrganizer,
    createdAt: threeMonthsAgo,
    updatedAt: oneMonthAgo,
    publishedAt: threeMonthsAgo,
  },
];

const LIVE_EVENTS: SeedEvent[] = [
  // event-007 — LIVE now. Free-plan org, meetup in Dakar. Proves the
  // `live` badge + real-time agenda view for the happiest plan tier.
  {
    id: "event-007",
    organizationId: IDS.freeOrgId,
    title: "Meetup Développeurs Dakar #13 (LIVE)",
    slug: "meetup-dev-dakar-13",
    description:
      "13ème édition du meetup mensuel des développeurs de Dakar. Au programme : Flutter 4.0, retour d'expérience IA générative en production, et open discussion networking.",
    shortDescription: "Meetup dev mensuel — en cours",
    coverImageURL: null,
    bannerImageURL: null,
    category: "networking",
    tags: ["meetup", "dev", "flutter", "ia", "dakar"],
    format: "in_person",
    status: "published",
    location: {
      name: "Jokkolabs Dakar",
      address: "Sicap Liberté 6, Villa 7691",
      city: "Dakar",
      country: "SN",
    },
    startDate: twoHoursAgo,
    endDate: inFourHours,
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "ticket-free-007",
        name: "Entrée libre",
        description: "Gratuit sur inscription",
        price: 0,
        currency: "XOF",
        totalQuantity: 50,
        soldCount: 42,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: 50,
    registeredCount: 42,
    checkedInCount: 28,
    isPublic: true,
    isFeatured: false,
    venueId: IDS.venue3,
    venueName: "Jokkolabs Dakar",
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.freeOrganizer,
    updatedBy: IDS.freeOrganizer,
    createdAt: oneWeekAgo,
    updatedAt: twoHoursAgo,
    publishedAt: oneWeekAgo,
  },

  // event-008 — LIVE now. Starter-plan org (Thiès Tech Collective), workshop
  // in Saint-Louis. First starter-tier event with actual registered count.
  {
    id: "event-008",
    organizationId: IDS.starterOrgId,
    title: "Workshop Design Digital Saint-Louis (LIVE)",
    slug: "workshop-digital-saint-louis",
    description:
      "Atelier pratique sur le design d'interfaces digitales pour les ONG et PME de la région Nord. Figma, prototypage rapide, accessibilité WCAG — en cours à l'Institut Français.",
    shortDescription: "Atelier design digital — en cours",
    coverImageURL: null,
    bannerImageURL: null,
    category: "workshop",
    tags: ["workshop", "design", "figma", "saint-louis"],
    format: "in_person",
    status: "published",
    location: {
      name: "Institut Français de Saint-Louis",
      address: "Rue Abdoulaye Seck Papa Mademba",
      city: "Saint-Louis",
      country: "SN",
    },
    startDate: oneHourAgo,
    endDate: inThreeHours,
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "ticket-workshop-008",
        name: "Participant",
        description: "Place atelier + kit Figma",
        price: 8000,
        currency: "XOF",
        totalQuantity: 40,
        soldCount: 36,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: 40,
    registeredCount: 36,
    checkedInCount: 31,
    isPublic: true,
    isFeatured: true,
    venueId: "venue-010",
    venueName: "Institut Français de Saint-Louis",
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.starterOrganizer,
    updatedBy: IDS.starterOrganizer,
    createdAt: twoWeeksAgo,
    updatedAt: oneHourAgo,
    publishedAt: twoWeeksAgo,
  },
];

const EXPANSION_EVENTS: SeedEvent[] = [
  ...PAST_EVENTS,
  ...LIVE_EVENTS,
];

// ─── Seed ────────────────────────────────────────────────────────────────

export async function seedEvents(db: Firestore): Promise<number> {
  const all = [...LEGACY_EVENTS, ...EXPANSION_EVENTS];

  await Promise.all(
    all.map((event) => db.collection("events").doc(event.id).set(event)),
  );

  return all.length;
}
