/**
 * Seed organizations — 6 total covering every plan tier plus a secondary
 * org per tier so features like "switch organization", "user belongs to
 * two orgs", and cross-org permission boundaries have data to exercise.
 *
 * Plan distribution:
 *   - free       × 1  (Startup Dakar)              → plan-gate tripwires
 *   - starter    × 2  (Dakar Venues, Abidjan …)    → mid-tier coverage
 *   - pro        × 2  (Teranga Events, Cultural)   → default demo org
 *   - enterprise × 1  (Groupe Sonatel Events)      → unlimited tier
 *
 * The `effectiveLimits`/`effectiveFeatures` snapshot is intentionally NOT
 * written here — the orchestrator calls `backfillEffectiveLimits()`
 * after all orgs are seeded so the plan catalog is the single source of
 * truth. Setting them here would duplicate the catalog and silently
 * drift on plan changes.
 */

import { ORG_IDS, USER_IDS } from "./ids";
import type { SeedContext, SeedModuleResult } from "./types";

type OrgFixture = {
  id: string;
  name: string;
  slug: string;
  description: string;
  plan: "free" | "starter" | "pro" | "enterprise";
  ownerId: string;
  memberIds: string[];
  country: string;
  city: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  isVerified: boolean;
};

const FIXTURES: OrgFixture[] = [
  {
    id: ORG_IDS.teranga,
    name: "Teranga Events",
    slug: "teranga-events",
    description: "Organisateur d'événements tech au Sénégal",
    plan: "pro",
    ownerId: USER_IDS.organizer,
    memberIds: [
      USER_IDS.organizer,
      USER_IDS.coOrganizer,
      USER_IDS.coOrganizer2,
      USER_IDS.multiRoleUser,
      USER_IDS.staffUser,
    ],
    country: "SN",
    city: "Dakar",
    phone: "+221770001234",
    email: "contact@teranga.events",
    website: "https://teranga.events",
    isVerified: true,
  },
  {
    id: ORG_IDS.venues,
    name: "Dakar Venues & Hospitality",
    slug: "dakar-venues",
    description: "Gestionnaire de lieux d'événements premium à Dakar",
    plan: "starter",
    ownerId: USER_IDS.venueManager,
    memberIds: [USER_IDS.venueManager],
    country: "SN",
    city: "Dakar",
    phone: "+221770004321",
    email: "contact@dakar-venues.sn",
    website: "https://dakar-venues.sn",
    isVerified: true,
  },
  {
    id: ORG_IDS.startup,
    name: "Startup Dakar",
    slug: "startup-dakar",
    description:
      "Petit collectif d'organisateurs de meetups tech à Dakar — plan gratuit",
    plan: "free",
    ownerId: USER_IDS.freeOrganizer,
    memberIds: [USER_IDS.freeOrganizer],
    country: "SN",
    city: "Dakar",
    phone: "+221770005555",
    email: "contact@startup-dakar.sn",
    website: null,
    isVerified: false,
  },
  {
    id: ORG_IDS.sonatel,
    name: "Groupe Sonatel Events",
    slug: "sonatel-events",
    description:
      "Division événementielle du Groupe Sonatel — plan enterprise",
    plan: "enterprise",
    ownerId: USER_IDS.enterpriseOrganizer,
    memberIds: [USER_IDS.enterpriseOrganizer, USER_IDS.staff2],
    country: "SN",
    city: "Dakar",
    phone: "+221770006666",
    email: "events@sonatel.sn",
    website: "https://sonatel.sn",
    isVerified: true,
  },
  {
    id: ORG_IDS.abidjanCollective,
    name: "Abidjan Tech Collective",
    slug: "abidjan-tech-collective",
    description:
      "Collectif francophone d'organisateurs tech en Côte d'Ivoire — événements pan-africains",
    plan: "starter",
    ownerId: USER_IDS.abidjanOrganizer,
    memberIds: [USER_IDS.abidjanOrganizer, USER_IDS.coOrganizer3],
    country: "CI",
    city: "Abidjan",
    phone: "+2250707010203",
    email: "contact@abidjantech.ci",
    website: "https://abidjantech.ci",
    isVerified: true,
  },
  {
    id: ORG_IDS.culturalPro,
    name: "Kora Productions",
    slug: "kora-productions",
    description:
      "Productions culturelles sénégalaises — concerts, festivals, cérémonies",
    plan: "pro",
    ownerId: USER_IDS.culturalOrganizer,
    memberIds: [USER_IDS.culturalOrganizer],
    country: "SN",
    city: "Dakar",
    phone: "+221771112233",
    email: "contact@kora-productions.sn",
    website: "https://kora-productions.sn",
    isVerified: true,
  },
];

export async function seedOrganizations(ctx: SeedContext): Promise<SeedModuleResult> {
  const { db } = ctx;
  const now = new Date().toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  for (const org of FIXTURES) {
    await db
      .collection("organizations")
      .doc(org.id)
      .set({
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description,
        logoURL: null,
        website: org.website,
        contactEmail: org.email,
        phone: org.phone,
        country: org.country,
        city: org.city,
        plan: org.plan,
        ownerId: org.ownerId,
        memberIds: org.memberIds,
        isVerified: org.isVerified,
        isActive: true,
        createdAt: twoDaysAgo,
        updatedAt: now,
      });
  }

  console.log(`  ✓ ${FIXTURES.length} organizations seeded (1 free, 2 starter, 2 pro, 1 enterprise)`);
  for (const org of FIXTURES) {
    console.log(`    · ${org.id} ${org.name.padEnd(32)} plan=${org.plan}`);
  }

  return {
    name: "organizations",
    created: FIXTURES.length,
    summary: `${FIXTURES.length} orgs across all 4 plans (free/starter×2/pro×2/enterprise)`,
  };
}
