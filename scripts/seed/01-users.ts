/**
 * Seed users — 40 total, spread across every platform role so demos,
 * E2E tests, admin-UI coverage, and permission checks all have realistic
 * fixtures to work with.
 *
 * Composition:
 *   - 13 legacy users (PR A + PR #59 role fixtures) — UIDs preserved verbatim
 *   - 27 PR B additions:
 *       * 2 more organizers (one per new org)
 *       * 2 more co-organizers (to exercise the "multi-co-org" fan-out)
 *       * 3 more speakers (so 20 events have distinct speakers)
 *       * 2 more sponsors (for extra booth coverage)
 *       * 1 more staff scanner
 *       * 18 more participants (18 + 2 legacy = 20 total, enough to fill
 *         registrations, feed posts, messages, and sponsor leads)
 *
 * All seeded users share the `@teranga.dev` email domain — same contract
 * as `seed-reset.ts` which deletes users by that suffix. Never add users
 * with a different domain unless you also update the reset filter.
 *
 * Naming: first names are drawn from the common francophone Senegalese /
 * Ivorian / Mauritanian diaspora to make the demos feel native to the
 * target market. Phone numbers use the Senegal country code (+221) for
 * participants and +225 for Abidjan-based fixtures.
 */

import { USER_IDS, ORG_IDS } from "./ids";
import type { SeedContext, SeedModuleResult } from "./types";
import { ensureUser } from "./utils";

type UserFixture = {
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  bio: string;
  roles: string[];
  organizationId?: string;
  /** Set false for the "auth-only" fixture so the trigger's default path runs. */
  writeProfile?: boolean;
};

/**
 * Complete roster — ordered by role family for easy scanning. The
 * displayName mix is intentionally culturally diverse (Wolof, Mandinka,
 * Peul, Ivorian) to reflect the platform's francophone West African
 * target market.
 */
const FIXTURES: UserFixture[] = [
  // ── Organizers ─────────────────────────────────────────────────────────
  {
    uid: USER_IDS.organizer,
    email: "organizer@teranga.dev",
    displayName: "Moussa Diop",
    phone: "+221770001234",
    bio: "Organisateur passionné de tech events à Dakar",
    roles: ["organizer"],
    organizationId: ORG_IDS.teranga,
  },
  {
    uid: USER_IDS.freeOrganizer,
    email: "free@teranga.dev",
    displayName: "Djibril Mbaye",
    phone: "+221770005555",
    bio: "Fondateur de Startup Dakar — meetups tech mensuels",
    roles: ["organizer"],
    organizationId: ORG_IDS.startup,
  },
  {
    uid: USER_IDS.enterpriseOrganizer,
    email: "enterprise@teranga.dev",
    displayName: "Mame Diarra Seck",
    phone: "+221770006666",
    bio: "Head of Events, Groupe Sonatel — événements corporate pan-africains",
    roles: ["organizer"],
    organizationId: ORG_IDS.sonatel,
  },
  {
    uid: USER_IDS.abidjanOrganizer,
    email: "abidjan@teranga.dev",
    displayName: "Koffi N'Guessan",
    phone: "+2250707010203",
    bio: "Organisateur d'événements tech et culturels à Abidjan",
    roles: ["organizer"],
    organizationId: ORG_IDS.abidjanCollective,
  },
  {
    uid: USER_IDS.culturalOrganizer,
    email: "culturel@teranga.dev",
    displayName: "Fatou Mbengue",
    phone: "+221771112233",
    bio: "Directrice artistique — concerts et festivals sénégalais",
    roles: ["organizer"],
    organizationId: ORG_IDS.culturalPro,
  },

  // ── Co-organizers ──────────────────────────────────────────────────────
  {
    uid: USER_IDS.coOrganizer,
    email: "coorganizer@teranga.dev",
    displayName: "Fatou Sall",
    phone: "+221770001235",
    bio: "Coordinatrice événementielle",
    roles: ["co_organizer"],
    organizationId: ORG_IDS.teranga,
  },
  {
    uid: USER_IDS.coOrganizer2,
    email: "coorganizer2@teranga.dev",
    displayName: "Aboubacar Cissé",
    phone: "+221771234567",
    bio: "Logistique et coordination — événements corporate",
    roles: ["co_organizer"],
    organizationId: ORG_IDS.teranga,
  },
  {
    uid: USER_IDS.coOrganizer3,
    email: "coorganizer3@teranga.dev",
    displayName: "Marie-Louise Koné",
    phone: "+2250505040302",
    bio: "Co-organisatrice Abidjan — relations sponsors",
    roles: ["co_organizer"],
    organizationId: ORG_IDS.abidjanCollective,
  },

  // ── Speakers ───────────────────────────────────────────────────────────
  {
    uid: USER_IDS.speakerUser,
    email: "speaker@teranga.dev",
    displayName: "Ibrahima Gueye",
    phone: "+221770007777",
    bio: "CTO & conférencier tech, expert Flutter et Firebase",
    roles: ["speaker"],
  },
  {
    uid: USER_IDS.speaker2,
    email: "speaker2@teranga.dev",
    displayName: "Ramatoulaye Diagne",
    phone: "+221771445566",
    bio: "Data scientist — spécialiste NLP et IA appliquée aux langues africaines",
    roles: ["speaker"],
  },
  {
    uid: USER_IDS.speaker3,
    email: "speaker3@teranga.dev",
    displayName: "Cheikh Anta Bâ",
    phone: "+221772223344",
    bio: "Product designer — design systems multiculturels",
    roles: ["speaker"],
  },
  {
    uid: USER_IDS.speaker4,
    email: "speaker4@teranga.dev",
    displayName: "Aya Traoré",
    phone: "+2250100203040",
    bio: "Experte fintech — payments pan-africains, basée à Abidjan",
    roles: ["speaker"],
  },

  // ── Sponsors ───────────────────────────────────────────────────────────
  {
    uid: USER_IDS.sponsorUser,
    email: "sponsor@teranga.dev",
    displayName: "Aissatou Ba",
    phone: "+221770008888",
    bio: "Directrice marketing chez TechCorp Dakar",
    roles: ["sponsor"],
  },
  {
    uid: USER_IDS.sponsor2,
    email: "sponsor2@teranga.dev",
    displayName: "Mbaye Seck",
    phone: "+221773334455",
    bio: "Partnership manager — Sonatel Orange",
    roles: ["sponsor"],
  },
  {
    uid: USER_IDS.sponsor3,
    email: "sponsor3@teranga.dev",
    displayName: "Sophie Konaté",
    phone: "+2250800900100",
    bio: "Communication sponsors — Fintech Abidjan",
    roles: ["sponsor"],
  },

  // ── Platform admin ─────────────────────────────────────────────────────
  {
    uid: USER_IDS.superAdmin,
    email: "admin@teranga.dev",
    displayName: "Abdoulaye Sarr",
    phone: "+221770001111",
    bio: "Administrateur plateforme Teranga",
    roles: ["super_admin"],
  },

  // ── Venue manager ──────────────────────────────────────────────────────
  {
    uid: USER_IDS.venueManager,
    email: "venue@teranga.dev",
    displayName: "Khady Niang",
    phone: "+221770002222",
    bio: "Directrice de Dakar Venues & Hospitality, gestion de lieux d'événements premium",
    roles: ["venue_manager"],
    organizationId: ORG_IDS.venues,
  },

  // ── Staff (QR scanners) ────────────────────────────────────────────────
  {
    uid: USER_IDS.staffUser,
    email: "staff@teranga.dev",
    displayName: "Moussa Sy",
    phone: "+221770003333",
    bio: "Responsable contrôle d'accès — scans QR à l'entrée des événements",
    roles: ["staff"],
    organizationId: ORG_IDS.teranga,
  },
  {
    uid: USER_IDS.staff2,
    email: "staff2@teranga.dev",
    displayName: "Aïda Thiam",
    phone: "+221774455667",
    bio: "Contrôle d'accès — événements grand public",
    roles: ["staff"],
    organizationId: ORG_IDS.sonatel,
  },

  // ── Multi-role fixture (PR #59) ────────────────────────────────────────
  {
    uid: USER_IDS.multiRoleUser,
    email: "multirole@teranga.dev",
    displayName: "Khadija Diop",
    phone: "+221770004444",
    bio: "Organise et intervient sur les meetups Flutter Dakar",
    roles: ["organizer", "speaker"],
    organizationId: ORG_IDS.teranga,
  },

  // ── Participants ───────────────────────────────────────────────────────
  // 20 total. First 2 are legacy — preserve bios byte-for-byte so existing
  // fixtures / screenshots continue to match.
  {
    uid: USER_IDS.participant1,
    email: "participant@teranga.dev",
    displayName: "Aminata Fall",
    phone: "+221770005678",
    bio: "Développeuse full-stack passionnée par le mobile",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant2,
    email: "participant2@teranga.dev",
    displayName: "Ousmane Ndiaye",
    phone: "+221770009999",
    bio: "Designer UX/UI — Figma addict",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant3,
    email: "participant3@teranga.dev",
    displayName: "Awa Sow",
    phone: "+221770010001",
    bio: "Étudiante en informatique à l'UCAD",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant4,
    email: "participant4@teranga.dev",
    displayName: "Babacar Diouf",
    phone: "+221770010002",
    bio: "Développeur backend — Go et Node.js",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant5,
    email: "participant5@teranga.dev",
    displayName: "Coumba Faye",
    phone: "+221770010003",
    bio: "Product manager dans une startup fintech",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant6,
    email: "participant6@teranga.dev",
    displayName: "Mamadou Camara",
    phone: "+221770010004",
    bio: "DevOps engineer — Kubernetes et GCP",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant7,
    email: "participant7@teranga.dev",
    displayName: "Ndeye Aïcha Bâ",
    phone: "+221770010005",
    bio: "Spécialiste marketing digital",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant8,
    email: "participant8@teranga.dev",
    displayName: "Souleymane Ndoye",
    phone: "+221770010006",
    bio: "Consultant en transformation numérique",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant9,
    email: "participant9@teranga.dev",
    displayName: "Yacine Diagne",
    phone: "+221770010007",
    bio: "Fondatrice d'une startup edtech",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant10,
    email: "participant10@teranga.dev",
    displayName: "Idrissa Gning",
    phone: "+221770010008",
    bio: "Journaliste tech — couvre l'écosystème africain",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant11,
    email: "participant11@teranga.dev",
    displayName: "Oumou Bah",
    phone: "+221770010009",
    bio: "Ingénieure data — basée à Thiès",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant12,
    email: "participant12@teranga.dev",
    displayName: "Thierno Diallo",
    phone: "+221770010010",
    bio: "Mobile developer — React Native",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant13,
    email: "participant13@teranga.dev",
    displayName: "Bintou Sangaré",
    phone: "+2250707080910",
    bio: "Entrepreneuse basée à Abidjan — e-commerce",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant14,
    email: "participant14@teranga.dev",
    displayName: "Tidiane Ba",
    phone: "+2250505060708",
    bio: "Ingénieur logiciel — Fintech Abidjan",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant15,
    email: "participant15@teranga.dev",
    displayName: "Mariam Touré",
    phone: "+221770010011",
    bio: "Artiste numérique — créatrice de contenu",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant16,
    email: "participant16@teranga.dev",
    displayName: "Ismaïla Kane",
    phone: "+221770010012",
    bio: "Photographe événementiel",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant17,
    email: "participant17@teranga.dev",
    displayName: "Fatimata Dia",
    phone: "+221770010013",
    bio: "Consultante RH — spécialiste tech",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant18,
    email: "participant18@teranga.dev",
    displayName: "Abdou Karim Wade",
    phone: "+221770010014",
    bio: "Blockchain developer — Solana et Ethereum",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant19,
    email: "participant19@teranga.dev",
    displayName: "Sokhna Mbaye",
    phone: "+221770010015",
    bio: "Avocate spécialisée en droit du numérique",
    roles: ["participant"],
  },
  {
    uid: USER_IDS.participant20,
    email: "participant20@teranga.dev",
    displayName: "Lamine Seck",
    phone: "+221770010016",
    bio: "Musicien — producteur de rap sénégalais",
    roles: ["participant"],
  },

  // ── Auth-only fixture (PR #59) ─────────────────────────────────────────
  // Deliberately last in the list so the `writeProfile: false` branch
  // sticks out. The onUserCreated trigger provisions this one with the
  // default `roles: ["participant"]`.
  {
    uid: USER_IDS.authOnlyUser,
    email: "authonly@teranga.dev",
    displayName: "Thierno Wade",
    phone: "+221770007000",
    bio: "",
    roles: [], // not applied to the profile doc — writeProfile is false
    writeProfile: false,
  },
];

/** Export the roster so other modules can read display names / emails. */
export const SEEDED_USERS = FIXTURES;

export async function seedUsers(ctx: SeedContext): Promise<SeedModuleResult> {
  const { db, auth } = ctx;
  const now = new Date().toISOString();

  // 1. Auth users — created first so the onUserCreated trigger has a
  // chance to run before we overwrite defaults with the profile merge.
  for (const fx of FIXTURES) {
    const claims: Record<string, unknown> = {};
    if (fx.roles.length > 0) claims.roles = fx.roles;
    if (fx.organizationId) claims.organizationId = fx.organizationId;
    // authonly gets `{}` on purpose — tests the trigger default path.
    await ensureUser(
      auth,
      fx.uid,
      {
        email: fx.email,
        password: "password123",
        displayName: fx.displayName,
      },
      claims,
    );
  }

  // 2. Firestore profiles — merge:true so any onUserCreated defaults
  // (preferredLanguage, fcmTokens, isEmailVerified) remain intact.
  // `writeProfile: false` skips the doc entirely for authonly.
  for (const fx of FIXTURES) {
    if (fx.writeProfile === false) continue;
    await db
      .collection("users")
      .doc(fx.uid)
      .set(
        {
          uid: fx.uid,
          email: fx.email,
          displayName: fx.displayName,
          photoURL: null,
          phone: fx.phone,
          bio: fx.bio || null,
          roles: fx.roles,
          organizationId: fx.organizationId ?? null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
  }

  const created = FIXTURES.length;
  console.log(`  ✓ ${created} auth users upserted (password: password123)`);
  console.log(`  ✓ ${FIXTURES.filter((f) => f.writeProfile !== false).length} Firestore profiles written`);

  return {
    name: "users",
    created,
    summary: `${created} users (organizers, speakers, sponsors, staff, 20 participants, admin, venue manager)`,
  };
}
