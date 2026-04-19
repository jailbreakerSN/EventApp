/**
 * Seed venue fixtures — 14 venues across francophone West Africa.
 *
 * Coverage goals:
 *   - Dakar  × 5  (legacy 3 + 2 new)  — flagship city, busiest events.
 *   - Saly   × 2                       — coastal resort, festival/concert.
 *   - Thiès  × 2                       — Sénégal #2 — new starter org home.
 *   - Saint-Louis × 2                  — cultural/jazz hub in the north.
 *   - Ziguinchor × 1                   — Casamance training outpost.
 *   - Abidjan × 1                      — Côte d'Ivoire expansion.
 *   - Bamako × 1                       — Mali expansion.
 *
 * Status mix (exercises admin moderation queues):
 *   - 11 approved, 2 pending, 1 suspended — covers every VenueStatusSchema
 *     branch consumed by /admin/venues and the venue discovery filter.
 */

import type { Firestore } from "firebase-admin/firestore";

import { Dates } from "./config";
import { EXPANSION_VENUE_IDS, IDS } from "./ids";

type SeedVenue = {
  id: string;
  name: string;
  slug: string;
  description: string;
  address: {
    street: string;
    city: string;
    region: string;
    country: string;
    coordinates: { lat: number; lng: number };
  };
  venueType:
    | "conference_center"
    | "hotel"
    | "coworking"
    | "cultural_space"
    | "outdoor"
    | "restaurant"
    | "university"
    | "sports"
    | "other";
  capacity: {
    min: number;
    max: number;
    configurations: { name: string; capacity: number }[];
  };
  amenities: string[];
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  website: string | null;
  hostOrganizationId: string | null;
  status: "approved" | "pending" | "suspended" | "archived";
  isFeatured: boolean;
  rating: number | null;
  eventCount: number;
  createdBy: string;
  updatedBy: string;
};

const { twoDaysAgo, yesterday, oneWeekAgo, now } = Dates;

// ─── Legacy venues (IDs preserved — referenced by event-001, event-004) ─────

const LEGACY_VENUES: SeedVenue[] = [
  {
    id: IDS.venue1,
    name: "CICAD — Centre International de Conferences",
    slug: "cicad-dakar",
    description:
      "Le Centre International de Conferences Abdou Diouf est le plus grand centre de conferences d'Afrique de l'Ouest, situe sur la route de King Fahd aux Almadies.",
    address: {
      street: "Route de King Fahd, Almadies",
      city: "Dakar",
      region: "Dakar",
      country: "SN",
      coordinates: { lat: 14.7453, lng: -17.5131 },
    },
    venueType: "conference_center",
    capacity: {
      min: 100,
      max: 5000,
      configurations: [
        { name: "Theatre", capacity: 5000 },
        { name: "Classe", capacity: 2000 },
        { name: "Banquet", capacity: 1500 },
      ],
    },
    amenities: [
      "wifi",
      "parking",
      "restauration",
      "climatisation",
      "sono",
      "projecteur",
      "traduction-simultanee",
    ],
    contactName: "Khady Niang",
    contactEmail: "reservation@cicad.sn",
    contactPhone: "+221338005000",
    website: "https://cicad.sn",
    hostOrganizationId: IDS.venueOrgId,
    status: "approved",
    isFeatured: true,
    rating: 4.5,
    eventCount: 1,
    createdBy: IDS.venueManager,
    updatedBy: IDS.superAdmin,
  },
  {
    id: IDS.venue2,
    name: "Radisson Blu Dakar Sea Plaza",
    slug: "radisson-blu-dakar",
    description:
      "Hotel 5 etoiles avec salles de conference vue mer. Ideal pour conferences business, workshops et evenements corporate.",
    address: {
      street: "Route de la Corniche, Sea Plaza",
      city: "Dakar",
      region: "Dakar",
      country: "SN",
      coordinates: { lat: 14.7183, lng: -17.4677 },
    },
    venueType: "hotel",
    capacity: {
      min: 20,
      max: 800,
      configurations: [
        { name: "Salle Teranga", capacity: 800 },
        { name: "Salle Baobab", capacity: 200 },
        { name: "Boardroom", capacity: 30 },
      ],
    },
    amenities: [
      "wifi",
      "parking",
      "restauration",
      "climatisation",
      "sono",
      "projecteur",
      "hebergement",
      "piscine",
    ],
    contactName: "Mamadou Fall",
    contactEmail: "events@radissonblu-dakar.com",
    contactPhone: "+221338891111",
    website: "https://radissonhotels.com/dakar",
    hostOrganizationId: IDS.venueOrgId,
    status: "approved",
    isFeatured: true,
    rating: 4.8,
    eventCount: 1,
    createdBy: IDS.venueManager,
    updatedBy: IDS.venueManager,
  },
  {
    id: IDS.venue3,
    name: "Jokkolabs Dakar",
    slug: "jokkolabs-dakar",
    description:
      "Espace de coworking et d'innovation au coeur de Dakar. Salles de reunion modulables, espace evenementiel, terrasse.",
    address: {
      street: "Sicap Liberte 6, Villa 7691",
      city: "Dakar",
      region: "Dakar",
      country: "SN",
      coordinates: { lat: 14.7167, lng: -17.45 },
    },
    venueType: "coworking",
    capacity: {
      min: 10,
      max: 120,
      configurations: [
        { name: "Open Space", capacity: 120 },
        { name: "Salle de conference", capacity: 50 },
        { name: "Workshop", capacity: 30 },
      ],
    },
    amenities: ["wifi", "climatisation", "projecteur", "cafe", "terrasse"],
    contactName: "Karim Sy",
    contactEmail: "events@jokkolabs.net",
    contactPhone: "+221776543210",
    website: "https://jokkolabs.net",
    hostOrganizationId: null,
    status: "pending",
    isFeatured: false,
    rating: null,
    eventCount: 0,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
];

// ─── Expansion venues (PR B — new in 11 cities/types) ──────────────────────

const EXPANSION_VENUES: SeedVenue[] = [
  {
    id: EXPANSION_VENUE_IDS[0], // venue-004
    name: "Les Almadies Events",
    slug: "almadies-events-dakar",
    description:
      "Espace évènementiel en bord de mer aux Almadies. Grande terrasse, capacité modulable, idéal pour lancements de produit et cocktails corporate.",
    address: {
      street: "Route des Almadies, Lot 42",
      city: "Dakar",
      region: "Dakar",
      country: "SN",
      coordinates: { lat: 14.7453, lng: -17.5262 },
    },
    venueType: "cultural_space",
    capacity: {
      min: 50,
      max: 400,
      configurations: [
        { name: "Cocktail", capacity: 400 },
        { name: "Banquet", capacity: 250 },
        { name: "Théâtre", capacity: 300 },
      ],
    },
    amenities: ["wifi", "climatisation", "sono", "projecteur", "terrasse", "restauration"],
    contactName: "Ndèye Astou Sall",
    contactEmail: "booking@almadies-events.sn",
    contactPhone: "+221338608400",
    website: "https://almadies-events.sn",
    hostOrganizationId: IDS.venueOrgId,
    status: "approved",
    isFeatured: true,
    rating: 4.6,
    eventCount: 1,
    createdBy: IDS.venueManager,
    updatedBy: IDS.superAdmin,
  },
  {
    id: EXPANSION_VENUE_IDS[1], // venue-005
    name: "Esplanade Monument de la Renaissance",
    slug: "monument-renaissance-dakar",
    description:
      "Esplanade emblématique en pied du Monument de la Renaissance Africaine. Cadre iconique pour concerts en plein air et festivals.",
    address: {
      street: "Colline des Mamelles, Ouakam",
      city: "Dakar",
      region: "Dakar",
      country: "SN",
      coordinates: { lat: 14.7247, lng: -17.4945 },
    },
    venueType: "outdoor",
    capacity: {
      min: 500,
      max: 15000,
      configurations: [{ name: "Concert", capacity: 15000 }],
    },
    amenities: ["parking", "securite", "sono-pro", "eclairage-scene"],
    contactName: "Momar Ngom",
    contactEmail: "events@monument-renaissance.sn",
    contactPhone: "+221338698200",
    website: null,
    hostOrganizationId: null,
    status: "approved",
    isFeatured: true,
    rating: 4.7,
    eventCount: 1,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
  {
    id: EXPANSION_VENUE_IDS[2], // venue-006
    name: "Palm Beach Resort Saly",
    slug: "palm-beach-saly",
    description:
      "Resort quatre étoiles en bord de mer à Saly. Piscine, plage privée, salles de conférence vue océan — destination business + détente.",
    address: {
      street: "Boulevard Maritime, Saly Portudal",
      city: "Saly",
      region: "Thiès",
      country: "SN",
      coordinates: { lat: 14.4417, lng: -17.0056 },
    },
    venueType: "hotel",
    capacity: {
      min: 30,
      max: 500,
      configurations: [
        { name: "Salle Baobab", capacity: 500 },
        { name: "Salle Flamboyant", capacity: 120 },
        { name: "Terrasse plage", capacity: 300 },
      ],
    },
    amenities: [
      "wifi",
      "parking",
      "restauration",
      "climatisation",
      "sono",
      "piscine",
      "plage",
      "hebergement",
    ],
    contactName: "Fatoumata Cissé",
    contactEmail: "events@palmbeach-saly.sn",
    contactPhone: "+221339572020",
    website: "https://palmbeach-saly.sn",
    hostOrganizationId: IDS.venueOrgId,
    status: "approved",
    isFeatured: true,
    rating: 4.4,
    eventCount: 1,
    createdBy: IDS.venueManager,
    updatedBy: IDS.venueManager,
  },
  {
    id: EXPANSION_VENUE_IDS[3], // venue-007
    name: "Saly Hotel & Spa",
    slug: "saly-hotel-spa",
    description:
      "Hôtel boutique à Saly, salle polyvalente pour festivals et évènements culturels. Accès direct à la plage.",
    address: {
      street: "Route de Ngaparou, Saly",
      city: "Saly",
      region: "Thiès",
      country: "SN",
      coordinates: { lat: 14.4502, lng: -17.0134 },
    },
    venueType: "hotel",
    capacity: {
      min: 20,
      max: 250,
      configurations: [
        { name: "Grande Salle", capacity: 250 },
        { name: "Salle Teranga", capacity: 80 },
      ],
    },
    amenities: ["wifi", "climatisation", "restauration", "spa", "piscine", "plage"],
    contactName: "Awa Diouf",
    contactEmail: "reservation@salyhotel.sn",
    contactPhone: "+221339573535",
    website: "https://salyhotel.sn",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 4.2,
    eventCount: 1,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
  {
    id: EXPANSION_VENUE_IDS[4], // venue-008
    name: "Palais des Congrès de Thiès",
    slug: "palais-congres-thies",
    description:
      "Centre de conférences régional à Thiès. Auditorium 1 200 places, salles modulables, équipements audio-visuels professionnels.",
    address: {
      street: "Avenue Léopold Sédar Senghor",
      city: "Thiès",
      region: "Thiès",
      country: "SN",
      coordinates: { lat: 14.7886, lng: -16.9246 },
    },
    venueType: "conference_center",
    capacity: {
      min: 50,
      max: 1200,
      configurations: [
        { name: "Auditorium", capacity: 1200 },
        { name: "Salle commissions", capacity: 200 },
      ],
    },
    amenities: ["wifi", "parking", "climatisation", "sono-pro", "projecteur", "restauration"],
    contactName: "Cheikh Mbaye",
    contactEmail: "reservation@palais-thies.sn",
    contactPhone: "+221339511010",
    website: null,
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 4.1,
    eventCount: 1,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
  {
    id: EXPANSION_VENUE_IDS[5], // venue-009
    name: "Stade Lat Dior",
    slug: "stade-lat-dior-thies",
    description:
      "Stade régional de Thiès, capacité 15 000 places. Accueille événements sportifs, marathons, grandes célébrations.",
    address: {
      street: "Quartier Keur Mame Elhadj",
      city: "Thiès",
      region: "Thiès",
      country: "SN",
      coordinates: { lat: 14.7812, lng: -16.9311 },
    },
    venueType: "sports",
    capacity: {
      min: 100,
      max: 15000,
      configurations: [{ name: "Terrain et gradins", capacity: 15000 }],
    },
    amenities: ["parking", "securite", "vestiaires", "infirmerie", "sono"],
    contactName: "Ibrahima Fall",
    contactEmail: "gestion@stade-latdior.sn",
    contactPhone: "+221339512525",
    website: null,
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 3.9,
    eventCount: 1,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
  {
    id: EXPANSION_VENUE_IDS[6], // venue-010
    name: "Institut Français de Saint-Louis",
    slug: "institut-francais-saint-louis",
    description:
      "Centre culturel au cœur de Saint-Louis. Théâtre, salles d'exposition, jardin. Hôte du Festival Jazz et de la Biennale Dak'Art.",
    address: {
      street: "Rue Adanson, Île Nord",
      city: "Saint-Louis",
      region: "Saint-Louis",
      country: "SN",
      coordinates: { lat: 16.0311, lng: -16.5072 },
    },
    venueType: "cultural_space",
    capacity: {
      min: 20,
      max: 400,
      configurations: [
        { name: "Théâtre", capacity: 400 },
        { name: "Salle d'exposition", capacity: 150 },
        { name: "Jardin", capacity: 200 },
      ],
    },
    amenities: ["wifi", "climatisation", "sono", "eclairage-scene", "jardin"],
    contactName: "Hélène Cisse",
    contactEmail: "reservation@if-saintlouis.sn",
    contactPhone: "+221339611717",
    website: "https://if-saintlouis.sn",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: true,
    rating: 4.6,
    eventCount: 1,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
  {
    id: EXPANSION_VENUE_IDS[7], // venue-011
    name: "Hôtel de la Poste Saint-Louis",
    slug: "hotel-poste-saint-louis",
    description:
      "Hôtel historique colonial sur l'île de Saint-Louis. Salle de réception, terrasse donnant sur le fleuve.",
    address: {
      street: "Rue Khalifa Ababacar Sy, Île Nord",
      city: "Saint-Louis",
      region: "Saint-Louis",
      country: "SN",
      coordinates: { lat: 16.0288, lng: -16.5059 },
    },
    venueType: "hotel",
    capacity: {
      min: 10,
      max: 120,
      configurations: [
        { name: "Salle de réception", capacity: 120 },
        { name: "Terrasse fleuve", capacity: 80 },
      ],
    },
    amenities: ["wifi", "restauration", "climatisation", "hebergement", "terrasse"],
    contactName: "Mariama Ba",
    contactEmail: "events@hotel-poste-sl.sn",
    contactPhone: "+221339611818",
    website: null,
    hostOrganizationId: null,
    status: "pending",
    isFeatured: false,
    rating: null,
    eventCount: 0,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
  {
    id: EXPANSION_VENUE_IDS[8], // venue-012
    name: "Alliance Franco-Sénégalaise de Ziguinchor",
    slug: "alliance-ziguinchor",
    description:
      "Centre culturel et espace de formation à Ziguinchor, Casamance. Salles de classe, auditorium, terrasse.",
    address: {
      street: "Rue du Commerce",
      city: "Ziguinchor",
      region: "Ziguinchor",
      country: "SN",
      coordinates: { lat: 12.5833, lng: -16.2719 },
    },
    venueType: "cultural_space",
    capacity: {
      min: 15,
      max: 180,
      configurations: [
        { name: "Auditorium", capacity: 180 },
        { name: "Salle de formation", capacity: 40 },
      ],
    },
    amenities: ["wifi", "climatisation", "projecteur", "cafe"],
    contactName: "Jean-Pierre Diatta",
    contactEmail: "contact@alliance-ziguinchor.sn",
    contactPhone: "+221339911515",
    website: null,
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 4.0,
    eventCount: 1,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
  {
    id: EXPANSION_VENUE_IDS[9], // venue-013
    name: "Sofitel Abidjan Hôtel Ivoire",
    slug: "sofitel-abidjan-ivoire",
    description:
      "Hôtel 5 étoiles emblématique d'Abidjan. Centre de conférences avec plus de 10 salles, auditorium 800 places, suites business.",
    address: {
      street: "Boulevard Hassan II, Cocody",
      city: "Abidjan",
      region: "Abidjan",
      country: "CI",
      coordinates: { lat: 5.3599, lng: -4.0083 },
    },
    venueType: "hotel",
    capacity: {
      min: 20,
      max: 800,
      configurations: [
        { name: "Auditorium", capacity: 800 },
        { name: "Salle Africa", capacity: 300 },
        { name: "Boardrooms", capacity: 20 },
      ],
    },
    amenities: [
      "wifi",
      "parking",
      "restauration",
      "climatisation",
      "sono",
      "projecteur",
      "hebergement",
      "piscine",
      "spa",
    ],
    contactName: "Adjoua Kouassi",
    contactEmail: "events@sofitel-ivoire.ci",
    contactPhone: "+22527221000",
    website: "https://sofitel-abidjan.com",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: true,
    rating: 4.9,
    eventCount: 1,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
  {
    id: EXPANSION_VENUE_IDS[10], // venue-014
    name: "Centre International de Conférences de Bamako",
    slug: "cicb-bamako",
    description:
      "Centre de conférences national à Bamako. Auditorium 1 500 places, salles de commissions, équipement de traduction multilingue.",
    address: {
      street: "Boulevard du 22 Octobre, ACI 2000",
      city: "Bamako",
      region: "Bamako",
      country: "ML",
      coordinates: { lat: 12.6392, lng: -8.0029 },
    },
    venueType: "conference_center",
    capacity: {
      min: 50,
      max: 1500,
      configurations: [
        { name: "Grand auditorium", capacity: 1500 },
        { name: "Salle de commission", capacity: 150 },
      ],
    },
    amenities: [
      "wifi",
      "parking",
      "climatisation",
      "sono-pro",
      "projecteur",
      "traduction-simultanee",
      "restauration",
    ],
    contactName: "Mamadou Traoré",
    contactEmail: "reservation@cicb.ml",
    contactPhone: "+22320225050",
    website: "https://cicb.ml",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 4.3,
    eventCount: 1,
    createdBy: IDS.superAdmin,
    updatedBy: IDS.superAdmin,
  },
];

/**
 * Timestamps (createdAt / updatedAt) deliberately staggered so the
 * "recently added" badge in /admin/venues exercises different buckets.
 */
function timestampFor(
  index: number,
  status: SeedVenue["status"],
): {
  createdAt: string;
  updatedAt: string;
} {
  if (status === "pending") return { createdAt: yesterday, updatedAt: yesterday };
  if (index < 3) return { createdAt: twoDaysAgo, updatedAt: now };
  if (index < 7) return { createdAt: oneWeekAgo, updatedAt: now };
  return { createdAt: oneWeekAgo, updatedAt: yesterday };
}

export async function seedVenues(db: Firestore): Promise<number> {
  const all = [...LEGACY_VENUES, ...EXPANSION_VENUES];

  await Promise.all(
    all.map((venue, index) =>
      db
        .collection("venues")
        .doc(venue.id)
        .set({
          ...venue,
          photos: [],
          ...timestampFor(index, venue.status),
        }),
    ),
  );

  return all.length;
}
