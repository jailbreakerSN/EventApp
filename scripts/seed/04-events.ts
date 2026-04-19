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
  yesterday,
  twoDaysAgo,
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

// ─── Expansion events (populated by subsequent commits in this PR) ──────

const EXPANSION_EVENTS: SeedEvent[] = [];

// ─── Seed ────────────────────────────────────────────────────────────────

export async function seedEvents(db: Firestore): Promise<number> {
  const all = [...LEGACY_EVENTS, ...EXPANSION_EVENTS];

  await Promise.all(
    all.map((event) => db.collection("events").doc(event.id).set(event)),
  );

  return all.length;
}
