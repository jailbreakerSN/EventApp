/**
 * Seed user fixtures — Firebase Auth accounts + companion Firestore profiles.
 *
 * Coverage goals (40 total):
 *   - 13 legacy role fixtures (pre-PR-B): organizer / co-organizer / 2
 *     participants / speaker / sponsor / super-admin / venue-manager / free-
 *     organizer / enterprise-organizer / staff / multirole / auth-only.
 *   - 1 starter-org organizer (new — owner of Thiès Tech Collective).
 *   - 27 participant personas spread across the 8 cities in the venue
 *     catalogue (Dakar × 10, Saly × 3, Thiès × 3, Saint-Louis × 3,
 *     Ziguinchor × 2, Abidjan × 3, Bamako × 2, Lomé × 1). Gives the
 *     discovery UI real name/photo/city diversity and leaves room for
 *     PR C to generate registrations mapping participants → events in
 *     their own cities.
 *
 * Idempotency:
 *   - `auth.createUser` falls back to `updateUser` when the uid exists.
 *   - Firestore `set(profile, { merge: true })` so the onUserCreated
 *     trigger's defaults (preferredLanguage, fcmTokens, isEmailVerified)
 *     are preserved across re-runs.
 *
 * Note:
 *   `authOnlyUser` (uid authonly-uid-001) is auth-only by design — see the
 *   commented-out profile entry below and the IDS comment in `ids.ts` — to
 *   exercise the onUserCreated trigger's "no existing Firestore profile →
 *   default to participant" branch. Do NOT add a profile for that uid.
 */

import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

import { Dates } from "./config";
import { EXPANSION_PARTICIPANT_UIDS, IDS } from "./ids";

const { twoDaysAgo, oneWeekAgo, now } = Dates;

const PASSWORD = "password123";

type AuthUserSpec = {
  uid: string;
  email: string;
  displayName: string;
  claims: Record<string, unknown>;
  /** omit to use default participant roles in trigger */
  profile?: {
    roles: string[];
    organizationId?: string;
    phone?: string;
    bio: string;
    city?: string;
  };
};

// ─── Legacy fixtures (must stay first — IDs & emails are load-bearing) ─────

const LEGACY_USERS: AuthUserSpec[] = [
  {
    uid: IDS.organizer,
    email: "organizer@teranga.dev",
    displayName: "Moussa Diop",
    claims: { roles: ["organizer"], organizationId: IDS.orgId },
    profile: {
      roles: ["organizer"],
      organizationId: IDS.orgId,
      phone: "+221770001234",
      bio: "Organisateur passionné de tech events à Dakar",
      city: "Dakar",
    },
  },
  {
    uid: IDS.coOrganizer,
    email: "coorganizer@teranga.dev",
    displayName: "Fatou Sall",
    claims: { roles: ["co_organizer"], organizationId: IDS.orgId },
    profile: {
      roles: ["co_organizer"],
      organizationId: IDS.orgId,
      phone: "+221770001235",
      bio: "Coordinatrice événementielle",
      city: "Dakar",
    },
  },
  {
    uid: IDS.participant1,
    email: "participant@teranga.dev",
    displayName: "Aminata Fall",
    claims: { roles: ["participant"] },
    profile: {
      roles: ["participant"],
      phone: "+221770005678",
      bio: "Développeuse full-stack passionnée par le mobile",
      city: "Dakar",
    },
  },
  {
    uid: IDS.participant2,
    email: "participant2@teranga.dev",
    displayName: "Ousmane Ndiaye",
    claims: { roles: ["participant"] },
    profile: {
      roles: ["participant"],
      phone: "+221770009999",
      bio: "Designer UX/UI — Figma addict",
      city: "Dakar",
    },
  },
  {
    uid: IDS.speakerUser,
    email: "speaker@teranga.dev",
    displayName: "Ibrahima Gueye",
    claims: { roles: ["speaker"] },
    profile: {
      roles: ["speaker"],
      phone: "+221770007777",
      bio: "CTO & conférencier tech, expert Flutter et Firebase",
      city: "Dakar",
    },
  },
  {
    uid: IDS.sponsorUser,
    email: "sponsor@teranga.dev",
    displayName: "Aissatou Ba",
    claims: { roles: ["sponsor"] },
    profile: {
      roles: ["sponsor"],
      phone: "+221770008888",
      bio: "Directrice marketing chez TechCorp Dakar",
      city: "Dakar",
    },
  },
  {
    uid: IDS.superAdmin,
    email: "admin@teranga.dev",
    displayName: "Abdoulaye Sarr",
    claims: { roles: ["super_admin"] },
    profile: {
      roles: ["super_admin"],
      phone: "+221770001111",
      bio: "Administrateur plateforme Teranga",
      city: "Dakar",
    },
  },
  {
    uid: IDS.venueManager,
    email: "venue@teranga.dev",
    displayName: "Khady Niang",
    claims: { roles: ["venue_manager"], organizationId: IDS.venueOrgId },
    profile: {
      roles: ["venue_manager"],
      organizationId: IDS.venueOrgId,
      phone: "+221770002222",
      bio: "Directrice de Dakar Venues & Hospitality, gestion de lieux d'événements premium",
      city: "Dakar",
    },
  },
  {
    uid: IDS.freeOrganizer,
    email: "free@teranga.dev",
    displayName: "Djibril Mbaye",
    claims: { roles: ["organizer"], organizationId: IDS.freeOrgId },
    profile: {
      roles: ["organizer"],
      organizationId: IDS.freeOrgId,
      phone: "+221770005555",
      bio: "Fondateur de Startup Dakar — meetups tech mensuels",
      city: "Dakar",
    },
  },
  {
    uid: IDS.enterpriseOrganizer,
    email: "enterprise@teranga.dev",
    displayName: "Mame Diarra Seck",
    claims: { roles: ["organizer"], organizationId: IDS.enterpriseOrgId },
    profile: {
      roles: ["organizer"],
      organizationId: IDS.enterpriseOrgId,
      phone: "+221770006666",
      bio: "Head of Events, Groupe Sonatel — événements corporate pan-africains",
      city: "Dakar",
    },
  },
  {
    uid: IDS.staffUser,
    email: "staff@teranga.dev",
    displayName: "Moussa Sy",
    claims: { roles: ["staff"], organizationId: IDS.orgId },
    profile: {
      roles: ["staff"],
      organizationId: IDS.orgId,
      phone: "+221770003333",
      bio: "Responsable contrôle d'accès — scans QR à l'entrée des événements",
      city: "Dakar",
    },
  },
  {
    uid: IDS.multiRoleUser,
    email: "multirole@teranga.dev",
    displayName: "Khadija Diop",
    claims: { roles: ["organizer", "speaker"], organizationId: IDS.orgId },
    profile: {
      roles: ["organizer", "speaker"],
      organizationId: IDS.orgId,
      phone: "+221770004444",
      bio: "Organise et intervient sur les meetups Flutter Dakar",
      city: "Dakar",
    },
  },
  {
    // NOTE: no `profile` — auth-only by design (exercises onUserCreated
    // trigger's default-participant path). See ids.ts header.
    uid: IDS.authOnlyUser,
    email: "authonly@teranga.dev",
    displayName: "Thierno Wade",
    claims: {},
  },
];

// ─── PR B — starter-org organizer (Thiès) ─────────────────────────────────

const STARTER_ORGANIZER: AuthUserSpec = {
  uid: IDS.starterOrganizer,
  email: "starter@teranga.dev",
  displayName: "Oumar Ba",
  claims: { roles: ["organizer"], organizationId: IDS.starterOrgId },
  profile: {
    roles: ["organizer"],
    organizationId: IDS.starterOrgId,
    phone: "+221770008001",
    bio: "Fondateur de Thiès Tech Collective, co-organise les conférences régionales",
    city: "Thiès",
  },
};

// ─── PR B — 27 participant personas across francophone West Africa ────────
// City distribution reflects venue coverage, so PR C can match participants
// to events in their own cities for realistic "events near you" behaviour.
//
// Dakar × 10, Saly × 3, Thiès × 3, Saint-Louis × 3, Ziguinchor × 2,
// Abidjan × 3, Bamako × 2, Lomé × 1 = 27.

type ParticipantPersona = {
  displayName: string;
  bio: string;
  city: string;
  phoneSuffix: string; // tail of the local format phone number
  phonePrefix: string; // local country dial code incl. "+"
};

const PARTICIPANT_PERSONAS: ParticipantPersona[] = [
  // Dakar (10)
  {
    displayName: "Mariama Sow",
    bio: "Product manager — fintech & paiement mobile",
    city: "Dakar",
    phoneSuffix: "10101001",
    phonePrefix: "+221",
  },
  {
    displayName: "Cheikh Ahmadou Ndiaye",
    bio: "Développeur backend Go — passionné systèmes distribués",
    city: "Dakar",
    phoneSuffix: "10101002",
    phonePrefix: "+221",
  },
  {
    displayName: "Astou Diouf",
    bio: "Data scientist — NLP pour langues africaines",
    city: "Dakar",
    phoneSuffix: "10101003",
    phonePrefix: "+221",
  },
  {
    displayName: "Mamadou Lamine Kane",
    bio: "Entrepreneur — SaaS e-commerce pour TPE",
    city: "Dakar",
    phoneSuffix: "10101004",
    phonePrefix: "+221",
  },
  {
    displayName: "Ndeye Rama Gueye",
    bio: "UX researcher — banking & mobile money",
    city: "Dakar",
    phoneSuffix: "10101005",
    phonePrefix: "+221",
  },
  {
    displayName: "Sékou Camara",
    bio: "DevOps engineer — infra cloud, Kubernetes",
    city: "Dakar",
    phoneSuffix: "10101006",
    phonePrefix: "+221",
  },
  {
    displayName: "Aby Ndoye",
    bio: "Community manager — communauté tech francophone",
    city: "Dakar",
    phoneSuffix: "10101007",
    phonePrefix: "+221",
  },
  {
    displayName: "Pape Demba Thiam",
    bio: "Étudiant en ingénierie informatique — UCAD",
    city: "Dakar",
    phoneSuffix: "10101008",
    phonePrefix: "+221",
  },
  {
    displayName: "Coumba Mbengue",
    bio: "Rédactrice tech — média africain en ligne",
    city: "Dakar",
    phoneSuffix: "10101009",
    phonePrefix: "+221",
  },
  {
    displayName: "Bacary Diédhiou",
    bio: "Consultant cybersécurité — audit PME",
    city: "Dakar",
    phoneSuffix: "10101010",
    phonePrefix: "+221",
  },
  // Saly (3)
  {
    displayName: "Yacine Diagne",
    bio: "Chef d'entreprise hôtelière — organisation de retraites tech",
    city: "Saly",
    phoneSuffix: "20202001",
    phonePrefix: "+221",
  },
  {
    displayName: "Ousseynou Sarr",
    bio: "Photographe événementiel — festivals & concerts",
    city: "Saly",
    phoneSuffix: "20202002",
    phonePrefix: "+221",
  },
  {
    displayName: "Binta Cissokho",
    bio: "Artiste peintre — biennale d'art contemporain",
    city: "Saly",
    phoneSuffix: "20202003",
    phonePrefix: "+221",
  },
  // Thiès (3)
  {
    displayName: "Omar Faye",
    bio: "Formateur développement web — bootcamp local",
    city: "Thiès",
    phoneSuffix: "30303001",
    phonePrefix: "+221",
  },
  {
    displayName: "Awa Ndao",
    bio: "Responsable RH — recrutement tech régional",
    city: "Thiès",
    phoneSuffix: "30303002",
    phonePrefix: "+221",
  },
  {
    displayName: "Modou Seck",
    bio: "Athlète amateur — marathon et courses longues distances",
    city: "Thiès",
    phoneSuffix: "30303003",
    phonePrefix: "+221",
  },
  // Saint-Louis (3)
  {
    displayName: "Fatou Binetou Sy",
    bio: "Musicienne jazz — festival de Saint-Louis",
    city: "Saint-Louis",
    phoneSuffix: "40404001",
    phonePrefix: "+221",
  },
  {
    displayName: "Alioune Badara Fall",
    bio: "Journaliste culturel — spécialiste patrimoine africain",
    city: "Saint-Louis",
    phoneSuffix: "40404002",
    phonePrefix: "+221",
  },
  {
    displayName: "Ramatoulaye Tall",
    bio: "Professeure d'université — digital humanities",
    city: "Saint-Louis",
    phoneSuffix: "40404003",
    phonePrefix: "+221",
  },
  // Ziguinchor (2)
  {
    displayName: "Simon Diatta",
    bio: "Coordinateur ONG — projets numériques en Casamance",
    city: "Ziguinchor",
    phoneSuffix: "50505001",
    phonePrefix: "+221",
  },
  {
    displayName: "Marie-Louise Manga",
    bio: "Enseignante en informatique — lycée régional",
    city: "Ziguinchor",
    phoneSuffix: "50505002",
    phonePrefix: "+221",
  },
  // Abidjan (3)
  {
    displayName: "Kouamé N'Guessan",
    bio: "CEO startup agri-tech — supply chain locale",
    city: "Abidjan",
    phoneSuffix: "60606001",
    phonePrefix: "+225",
  },
  {
    displayName: "Akissi Yao",
    bio: "Développeuse mobile Flutter — expatriée sénégalaise",
    city: "Abidjan",
    phoneSuffix: "60606002",
    phonePrefix: "+225",
  },
  {
    displayName: "Serge Konan",
    bio: "Investisseur angel — fonds tech francophone",
    city: "Abidjan",
    phoneSuffix: "60606003",
    phonePrefix: "+225",
  },
  // Bamako (2)
  {
    displayName: "Adama Dembélé",
    bio: "Ingénieur ML — application au diagnostic médical",
    city: "Bamako",
    phoneSuffix: "70707001",
    phonePrefix: "+223",
  },
  {
    displayName: "Fatoumata Coulibaly",
    bio: "Activiste numérique — inclusion féminine dans la tech",
    city: "Bamako",
    phoneSuffix: "70707002",
    phonePrefix: "+223",
  },
  // Lomé (1)
  {
    displayName: "Koffi Akakpo",
    bio: "Product designer — applications mobiles pour e-santé",
    city: "Lomé",
    phoneSuffix: "80808001",
    phonePrefix: "+228",
  },
];

/**
 * Build the email address for an expansion participant from their display
 * name + seed index. Kept as a standalone helper so PR C (registrations)
 * can materialise the same email without re-importing the personas list.
 */
export function expansionParticipantEmail(displayName: string, index: number): string {
  const slug = displayName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 30);
  return `${slug}.${index + 3}@teranga.dev`;
}

/**
 * Summary of a single expansion participant — what downstream modules (PR C
 * registrations, PR D feed) need to attach a real name/email/city to their
 * fixtures without depending on the full persona shape.
 */
export type ExpansionParticipant = {
  uid: string;
  displayName: string;
  email: string;
  city: string;
  index: number; // 0-based index into EXPANSION_PARTICIPANT_UIDS
};

/**
 * Materialised list of the 27 expansion participants. Index in this array
 * matches index in `EXPANSION_PARTICIPANT_UIDS`.
 */
export const EXPANSION_PARTICIPANTS: readonly ExpansionParticipant[] = PARTICIPANT_PERSONAS.map(
  (persona, index) => ({
    uid: EXPANSION_PARTICIPANT_UIDS[index],
    displayName: persona.displayName,
    email: expansionParticipantEmail(persona.displayName, index),
    city: persona.city,
    index,
  }),
);

function expansionParticipantSpec(
  uid: string,
  persona: ParticipantPersona,
  index: number,
): AuthUserSpec {
  const email = expansionParticipantEmail(persona.displayName, index);
  return {
    uid,
    email,
    displayName: persona.displayName,
    claims: { roles: ["participant"] },
    profile: {
      roles: ["participant"],
      phone: `${persona.phonePrefix}${persona.phoneSuffix}`,
      bio: persona.bio,
      city: persona.city,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureAuthUser(auth: Auth, spec: AuthUserSpec): Promise<void> {
  try {
    await auth.createUser({
      uid: spec.uid,
      email: spec.email,
      password: PASSWORD,
      displayName: spec.displayName,
      emailVerified: true,
    });
  } catch (err: unknown) {
    const code = (err as { errorInfo?: { code?: string } })?.errorInfo?.code;
    if (code !== "auth/uid-already-exists" && code !== "auth/email-already-exists") {
      throw err;
    }
    await auth.updateUser(spec.uid, { displayName: spec.displayName });
  }
  await auth.setCustomUserClaims(spec.uid, spec.claims);
}

async function writeProfile(db: Firestore, spec: AuthUserSpec, createdAt: string): Promise<void> {
  if (!spec.profile) return; // authOnlyUser stays auth-only
  await db
    .collection("users")
    .doc(spec.uid)
    .set(
      {
        uid: spec.uid,
        email: spec.email,
        displayName: spec.displayName,
        photoURL: null,
        isActive: true,
        roles: spec.profile.roles,
        ...(spec.profile.organizationId ? { organizationId: spec.profile.organizationId } : {}),
        ...(spec.profile.phone ? { phone: spec.profile.phone } : {}),
        bio: spec.profile.bio,
        ...(spec.profile.city ? { city: spec.profile.city } : {}),
        createdAt,
        updatedAt: now,
      },
      { merge: true },
    );
}

export async function seedUsers(
  auth: Auth,
  db: Firestore,
): Promise<{ total: number; legacy: number; expansion: number }> {
  const expansionParticipants = EXPANSION_PARTICIPANT_UIDS.map((uid, i) =>
    expansionParticipantSpec(uid, PARTICIPANT_PERSONAS[i], i),
  );

  const all = [...LEGACY_USERS, STARTER_ORGANIZER, ...expansionParticipants];

  // Auth + claims first (sequential to avoid emulator throttling), then
  // Firestore profile writes in parallel.
  for (const spec of all) {
    await ensureAuthUser(auth, spec);
  }
  await Promise.all(
    all.map((spec, index) =>
      writeProfile(
        db,
        spec,
        // Stagger profile createdAt so admin lists sort cleanly.
        index < LEGACY_USERS.length ? twoDaysAgo : oneWeekAgo,
      ),
    ),
  );

  return {
    total: all.length,
    legacy: LEGACY_USERS.length,
    expansion: 1 + expansionParticipants.length,
  };
}
