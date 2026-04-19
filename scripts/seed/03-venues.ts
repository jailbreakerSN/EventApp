/**
 * Seed venues — 14 total across 5 cities in 2 countries, covering every
 * `VenueType` enum value at least once so the venue filter UI has live
 * data to render:
 *
 *   conference_center × 1  (CICAD, Dakar)
 *   hotel             × 4  (Radisson Blu Dakar, King Fahd Dakar,
 *                           Saly Resort, Sofitel Ivoire Abidjan)
 *   coworking         × 1  (Jokkolabs Dakar)
 *   cultural_space    × 5  (Grand Théâtre Dakar, Musée Civilisations,
 *                           Espace Thiès, Jazz Saint-Louis, Goethe Abidjan)
 *   outdoor           × 1  (Esplanade des Almadies)
 *   sports            × 1  (Stade Léopold Sédar Senghor)
 *   university        × 1  (UCAD Campus)
 *
 * Status distribution: 12 approved, 1 pending (Jokkolabs — legacy PR A
 * pending fixture), 1 suspended (UCAD — new, to exercise the suspended
 * branch of the admin UI).
 *
 * Coordinates are real (sourced from publicly available map data) so the
 * participant web app's map pin cluster renders realistic dots.
 */

import { CITIES } from "./config";
import { ORG_IDS, USER_IDS, VENUE_IDS } from "./ids";
import type { SeedContext, SeedModuleResult } from "./types";

type VenueFixture = {
  id: string;
  name: string;
  slug: string;
  description: string;
  street: string;
  cityKey: keyof typeof CITIES;
  coordinates: { lat: number; lng: number };
  venueType:
    | "hotel"
    | "conference_center"
    | "cultural_space"
    | "coworking"
    | "restaurant"
    | "outdoor"
    | "university"
    | "sports"
    | "other";
  capacityMin: number;
  capacityMax: number;
  configurations: Array<{ name: string; capacity: number }>;
  amenities: string[];
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  website: string | null;
  hostOrganizationId: string | null;
  status: "pending" | "approved" | "suspended" | "archived";
  isFeatured: boolean;
  rating: number | null;
  eventCount: number;
};

const FIXTURES: VenueFixture[] = [
  // ── Dakar: conference_center ──────────────────────────────────────────
  {
    id: VENUE_IDS.cicad,
    name: "CICAD — Centre International de Conferences",
    slug: "cicad-dakar",
    description:
      "Le Centre International de Conferences Abdou Diouf est le plus grand centre de conferences d'Afrique de l'Ouest, situe sur la route de King Fahd aux Almadies.",
    street: "Route de King Fahd, Almadies",
    cityKey: "dakar",
    coordinates: { lat: 14.7453, lng: -17.5131 },
    venueType: "conference_center",
    capacityMin: 100,
    capacityMax: 5000,
    configurations: [
      { name: "Theatre", capacity: 5000 },
      { name: "Classe", capacity: 2000 },
      { name: "Banquet", capacity: 1500 },
    ],
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
    hostOrganizationId: ORG_IDS.venues,
    status: "approved",
    isFeatured: true,
    rating: 4.5,
    eventCount: 0, // orchestrator will bump when events ref this venue
  },

  // ── Dakar: hotel ──────────────────────────────────────────────────────
  {
    id: VENUE_IDS.radisson,
    name: "Radisson Blu Dakar Sea Plaza",
    slug: "radisson-blu-dakar",
    description:
      "Hotel 5 etoiles avec salles de conference vue mer. Ideal pour conferences business, workshops et evenements corporate.",
    street: "Route de la Corniche, Sea Plaza",
    cityKey: "dakar",
    coordinates: { lat: 14.7183, lng: -17.4677 },
    venueType: "hotel",
    capacityMin: 20,
    capacityMax: 800,
    configurations: [
      { name: "Salle Teranga", capacity: 800 },
      { name: "Salle Baobab", capacity: 200 },
      { name: "Boardroom", capacity: 30 },
    ],
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
    hostOrganizationId: ORG_IDS.venues,
    status: "approved",
    isFeatured: true,
    rating: 4.8,
    eventCount: 0,
  },

  // ── Dakar: coworking (pending) ────────────────────────────────────────
  {
    id: VENUE_IDS.jokkolabs,
    name: "Jokkolabs Dakar",
    slug: "jokkolabs-dakar",
    description:
      "Espace de coworking et d'innovation au coeur de Dakar. Salles de reunion modulables, espace evenementiel, terrasse.",
    street: "Sicap Liberte 6, Villa 7691",
    cityKey: "dakar",
    coordinates: { lat: 14.7167, lng: -17.45 },
    venueType: "coworking",
    capacityMin: 10,
    capacityMax: 120,
    configurations: [
      { name: "Open Space", capacity: 120 },
      { name: "Salle de conference", capacity: 50 },
      { name: "Workshop", capacity: 30 },
    ],
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
  },

  // ── Dakar: cultural_space ─────────────────────────────────────────────
  {
    id: VENUE_IDS.grandTheatre,
    name: "Grand Théâtre National de Dakar",
    slug: "grand-theatre-dakar",
    description:
      "Emblème culturel de Dakar, ce théâtre accueille concerts classiques, opéras, festivals et cérémonies officielles depuis 2011.",
    street: "Place du Souvenir Africain, Corniche Ouest",
    cityKey: "dakar",
    coordinates: { lat: 14.682, lng: -17.43 },
    venueType: "cultural_space",
    capacityMin: 200,
    capacityMax: 1800,
    configurations: [
      { name: "Salle principale", capacity: 1800 },
      { name: "Salle de répétition", capacity: 200 },
    ],
    amenities: ["wifi", "parking", "climatisation", "sono", "regie-lumiere", "loges"],
    contactName: "Amadou Seye",
    contactEmail: "contact@grandtheatre.sn",
    contactPhone: "+221338505000",
    website: "https://grandtheatre.sn",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: true,
    rating: 4.7,
    eventCount: 0,
  },

  {
    id: VENUE_IDS.museeCivilisations,
    name: "Musée des Civilisations Noires",
    slug: "musee-civilisations-noires",
    description:
      "Ouvert en 2018, ce musée de 14 000 m² met en lumière le patrimoine africain et accueille vernissages, expositions temporaires et conférences.",
    street: "Autoroute, Route de l'Aéroport",
    cityKey: "dakar",
    coordinates: { lat: 14.72, lng: -17.45 },
    venueType: "cultural_space",
    capacityMin: 50,
    capacityMax: 600,
    configurations: [
      { name: "Hall principal", capacity: 600 },
      { name: "Auditorium", capacity: 250 },
    ],
    amenities: ["wifi", "parking", "climatisation", "sono", "projecteur", "exposition"],
    contactName: "Mariama Cissé",
    contactEmail: "contact@mcn.sn",
    contactPhone: "+221338223322",
    website: "https://mcn.sn",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 4.6,
    eventCount: 0,
  },

  // ── Dakar: hotel #2 ───────────────────────────────────────────────────
  {
    id: VENUE_IDS.kingFahdPalace,
    name: "King Fahd Palace Hotel",
    slug: "king-fahd-palace-dakar",
    description:
      "Hôtel 5 étoiles aux Almadies avec 18 salles de réunion, deux ballrooms et une résidence pour les invités VIP.",
    street: "Route des Almadies",
    cityKey: "dakar",
    coordinates: { lat: 14.7444, lng: -17.5167 },
    venueType: "hotel",
    capacityMin: 20,
    capacityMax: 1500,
    configurations: [
      { name: "Grand Ballroom", capacity: 1500 },
      { name: "Salle Teranga", capacity: 400 },
      { name: "Boardroom", capacity: 20 },
    ],
    amenities: [
      "wifi",
      "parking",
      "restauration",
      "climatisation",
      "sono",
      "projecteur",
      "hebergement",
      "piscine",
      "golf",
    ],
    contactName: "Bassirou Diop",
    contactEmail: "events@kingfahdpalace.com",
    contactPhone: "+221338697676",
    website: "https://kingfahdpalace.com",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: true,
    rating: 4.7,
    eventCount: 0,
  },

  // ── Dakar: sports ─────────────────────────────────────────────────────
  {
    id: VENUE_IDS.stadeLSS,
    name: "Stade Léopold Sédar Senghor",
    slug: "stade-lss",
    description:
      "Plus grand stade du Sénégal, 60 000 places — accueille événements sportifs, concerts grand public et cérémonies nationales.",
    street: "Route de l'Aéroport, Parcelles Assainies",
    cityKey: "dakar",
    coordinates: { lat: 14.7167, lng: -17.4667 },
    venueType: "sports",
    capacityMin: 1000,
    capacityMax: 60000,
    configurations: [
      { name: "Configuration sport", capacity: 60000 },
      { name: "Configuration concert", capacity: 45000 },
    ],
    amenities: ["parking", "sono", "regie-lumiere", "loges", "securite"],
    contactName: "Pape Diouf",
    contactEmail: "reservation@stade-lss.sn",
    contactPhone: "+221338271010",
    website: null,
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 4.2,
    eventCount: 0,
  },

  // ── Dakar: outdoor ────────────────────────────────────────────────────
  {
    id: VENUE_IDS.esplanadeAlmadies,
    name: "Esplanade des Almadies",
    slug: "esplanade-almadies",
    description:
      "Grande esplanade en bord de mer — cadre idéal pour festivals, food trucks, cérémonies en plein air.",
    street: "Corniche des Almadies",
    cityKey: "dakar",
    coordinates: { lat: 14.7397, lng: -17.5206 },
    venueType: "outdoor",
    capacityMin: 200,
    capacityMax: 5000,
    configurations: [
      { name: "Configuration festival", capacity: 5000 },
      { name: "Configuration concert", capacity: 3000 },
    ],
    amenities: ["parking", "sono", "electricite", "securite", "bar"],
    contactName: "Fallou Ndiaye",
    contactEmail: "reservation@esplanade-almadies.sn",
    contactPhone: "+221776111222",
    website: null,
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 4.3,
    eventCount: 0,
  },

  // ── Saly: hotel ───────────────────────────────────────────────────────
  {
    id: VENUE_IDS.salyResort,
    name: "Rhino Club Resort Saly",
    slug: "rhino-club-saly",
    description:
      "Complexe hôtelier en bord de plage à Saly — idéal pour retreats, séminaires résidentiels et team-buildings.",
    street: "Route de Saly Portudal",
    cityKey: "saly",
    coordinates: { lat: 14.4417, lng: -17.0056 },
    venueType: "hotel",
    capacityMin: 10,
    capacityMax: 400,
    configurations: [
      { name: "Salle principale", capacity: 400 },
      { name: "Salle Baobab", capacity: 150 },
      { name: "Plage privée", capacity: 300 },
    ],
    amenities: [
      "wifi",
      "parking",
      "restauration",
      "climatisation",
      "sono",
      "projecteur",
      "hebergement",
      "piscine",
      "plage",
    ],
    contactName: "Awa Diouf",
    contactEmail: "events@rhino-saly.com",
    contactPhone: "+221339572000",
    website: "https://rhino-saly.com",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: true,
    rating: 4.6,
    eventCount: 0,
  },

  // ── Thiès: cultural_space ────────────────────────────────────────────
  {
    id: VENUE_IDS.espaceThies,
    name: "Espace Culturel de Thiès",
    slug: "espace-culturel-thies",
    description:
      "Centre culturel moderne au cœur de Thiès — salle de spectacle, salles de formation, expositions.",
    street: "Avenue Lamine Gueye",
    cityKey: "thies",
    coordinates: { lat: 14.7886, lng: -16.9246 },
    venueType: "cultural_space",
    capacityMin: 30,
    capacityMax: 500,
    configurations: [
      { name: "Salle de spectacle", capacity: 500 },
      { name: "Salle de formation", capacity: 50 },
    ],
    amenities: ["wifi", "parking", "climatisation", "sono", "projecteur"],
    contactName: "Moustapha Sylla",
    contactEmail: "contact@espace-thies.sn",
    contactPhone: "+221339515050",
    website: null,
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 4.1,
    eventCount: 0,
  },

  // ── Saint-Louis: cultural_space ───────────────────────────────────────
  {
    id: VENUE_IDS.saintLouisJazz,
    name: "Club Saint-Louis Jazz",
    slug: "saint-louis-jazz",
    description:
      "Lieu historique du festival Saint-Louis Jazz — scène intime, ambiance chaleureuse au bord du fleuve Sénégal.",
    street: "Quai Roume, île Nord",
    cityKey: "saintLouis",
    coordinates: { lat: 16.0179, lng: -16.4896 },
    venueType: "cultural_space",
    capacityMin: 50,
    capacityMax: 350,
    configurations: [
      { name: "Configuration concert", capacity: 350 },
      { name: "Configuration club", capacity: 150 },
    ],
    amenities: ["wifi", "sono", "regie-lumiere", "bar", "terrasse"],
    contactName: "Babacar Mbaye",
    contactEmail: "contact@stlouis-jazz.sn",
    contactPhone: "+221339611212",
    website: "https://saintlouisjazz.org",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: true,
    rating: 4.8,
    eventCount: 0,
  },

  // ── Abidjan: hotel ────────────────────────────────────────────────────
  {
    id: VENUE_IDS.sofitelIvoire,
    name: "Sofitel Abidjan Hôtel Ivoire",
    slug: "sofitel-abidjan-ivoire",
    description:
      "Emblème de la ville d'Abidjan, cet hôtel historique accueille les grands sommets ouest-africains et des conférences internationales.",
    street: "Boulevard Hassan II, Cocody",
    cityKey: "abidjan",
    coordinates: { lat: 5.3599, lng: -4.0083 },
    venueType: "hotel",
    capacityMin: 30,
    capacityMax: 1200,
    configurations: [
      { name: "Salle de la Paix", capacity: 1200 },
      { name: "Salle Ivoire", capacity: 400 },
      { name: "Boardroom", capacity: 25 },
    ],
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
    contactName: "Bernadette Koffi",
    contactEmail: "events@sofitel-ivoire.ci",
    contactPhone: "+2252720485050",
    website: "https://sofitel.accor.com/ivoire",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: true,
    rating: 4.6,
    eventCount: 0,
  },

  // ── Abidjan: cultural_space ───────────────────────────────────────────
  {
    id: VENUE_IDS.goetheAbidjan,
    name: "Goethe-Institut Côte d'Ivoire",
    slug: "goethe-abidjan",
    description:
      "Lieu de rencontre culturelle francophone-germanophone à Abidjan — salle de conférences, bibliothèque, amphithéâtre.",
    street: "Cocody, Rue Washington",
    cityKey: "abidjan",
    coordinates: { lat: 5.3555, lng: -3.9972 },
    venueType: "cultural_space",
    capacityMin: 20,
    capacityMax: 250,
    configurations: [
      { name: "Amphithéâtre", capacity: 250 },
      { name: "Salle de séminaire", capacity: 50 },
    ],
    amenities: ["wifi", "climatisation", "sono", "projecteur", "bibliotheque"],
    contactName: "Claudia Heindl",
    contactEmail: "events@goethe.ci",
    contactPhone: "+2252722443322",
    website: "https://www.goethe.de/ci",
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: 4.4,
    eventCount: 0,
  },

  // ── Dakar: university (suspended) ─────────────────────────────────────
  {
    id: VENUE_IDS.ucadCampus,
    name: "UCAD — Campus Universitaire",
    slug: "ucad-campus",
    description:
      "Université Cheikh Anta Diop de Dakar — amphithéâtres et espaces événementiels réservés à la communauté académique.",
    street: "Avenue Cheikh Anta Diop",
    cityKey: "dakar",
    coordinates: { lat: 14.6928, lng: -17.4467 },
    venueType: "university",
    capacityMin: 50,
    capacityMax: 2000,
    configurations: [
      { name: "Amphithéâtre UCAD I", capacity: 800 },
      { name: "Amphithéâtre UCAD II", capacity: 600 },
      { name: "Salle de conférence", capacity: 150 },
    ],
    amenities: ["wifi", "parking", "projecteur", "sono"],
    contactName: "Pr Oumar Sock",
    contactEmail: "evenements@ucad.sn",
    contactPhone: "+221338250000",
    website: "https://ucad.sn",
    hostOrganizationId: null,
    // Suspended to exercise the suspended-venue branch of the admin UI.
    status: "suspended",
    isFeatured: false,
    rating: null,
    eventCount: 0,
  },
];

export async function seedVenues(ctx: SeedContext): Promise<SeedModuleResult> {
  const { db } = ctx;
  const now = new Date().toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  for (const venue of FIXTURES) {
    const city = CITIES[venue.cityKey];
    await db
      .collection("venues")
      .doc(venue.id)
      .set({
        id: venue.id,
        name: venue.name,
        slug: venue.slug,
        description: venue.description,
        address: {
          street: venue.street,
          city: city.name,
          region: city.region ?? null,
          country: city.countryCode,
          coordinates: venue.coordinates,
        },
        venueType: venue.venueType,
        capacity: {
          min: venue.capacityMin,
          max: venue.capacityMax,
          configurations: venue.configurations,
        },
        amenities: venue.amenities,
        photos: [],
        contactName: venue.contactName,
        contactEmail: venue.contactEmail,
        contactPhone: venue.contactPhone,
        website: venue.website,
        hostOrganizationId: venue.hostOrganizationId,
        status: venue.status,
        isFeatured: venue.isFeatured,
        rating: venue.rating,
        eventCount: venue.eventCount,
        createdBy: USER_IDS.venueManager,
        updatedBy: USER_IDS.superAdmin,
        createdAt: twoDaysAgo,
        updatedAt: now,
      });
  }

  const approved = FIXTURES.filter((v) => v.status === "approved").length;
  const pending = FIXTURES.filter((v) => v.status === "pending").length;
  const suspended = FIXTURES.filter((v) => v.status === "suspended").length;

  console.log(
    `  ✓ ${FIXTURES.length} venues seeded (${approved} approved, ${pending} pending, ${suspended} suspended)`,
  );
  console.log(
    `    Cities: Dakar × ${FIXTURES.filter((v) => v.cityKey === "dakar").length}, ` +
      `Saly × ${FIXTURES.filter((v) => v.cityKey === "saly").length}, ` +
      `Thiès × ${FIXTURES.filter((v) => v.cityKey === "thies").length}, ` +
      `Saint-Louis × ${FIXTURES.filter((v) => v.cityKey === "saintLouis").length}, ` +
      `Abidjan × ${FIXTURES.filter((v) => v.cityKey === "abidjan").length}`,
  );

  return {
    name: "venues",
    created: FIXTURES.length,
    summary: `${FIXTURES.length} venues across 5 cities, all VenueType enum values covered`,
  };
}
