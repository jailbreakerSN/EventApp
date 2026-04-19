/**
 * Seed organisation fixtures — 5 orgs, one per plan tier plus two starters
 * (venue host + Thiès regional tech collective).
 *
 * Coverage goals:
 *   - org-001 (pro)        — Teranga Events, Dakar, owner of 8 events.
 *   - org-002 (starter)    — Dakar Venues, 0 events (venue host pattern).
 *   - org-003 (free)       — Startup Dakar, exercises free-tier limits (3 max).
 *   - org-004 (enterprise) — Groupe Sonatel, unlimited everything.
 *   - org-005 (starter)    — Thiès Tech Collective (PR B), 4 events — finally
 *     exercises the starter plan with real activity density.
 *
 * The matching Firestore `subscriptions/` docs are seeded by the orchestrator
 * later (section 20 of seed-emulators.ts, still inline).
 */

import type { Firestore } from "firebase-admin/firestore";

import { Dates } from "./config";
import { IDS } from "./ids";

const { twoDaysAgo, oneWeekAgo, now } = Dates;

type SeedOrg = {
  id: string;
  name: string;
  slug: string;
  description: string;
  website: string | null;
  contactEmail: string;
  phone: string;
  country: string;
  city: string;
  plan: "free" | "starter" | "pro" | "enterprise";
  ownerId: string;
  memberIds: string[];
  isVerified: boolean;
};

const ORGS: SeedOrg[] = [
  {
    id: IDS.orgId,
    name: "Teranga Events",
    slug: "teranga-events",
    description: "Organisateur d'événements tech au Sénégal",
    website: "https://teranga.events",
    contactEmail: "contact@teranga.events",
    phone: "+221770001234",
    country: "SN",
    city: "Dakar",
    plan: "pro",
    ownerId: IDS.organizer,
    memberIds: [IDS.organizer, IDS.coOrganizer],
    isVerified: true,
  },
  {
    id: IDS.venueOrgId,
    name: "Dakar Venues & Hospitality",
    slug: "dakar-venues",
    description: "Gestionnaire de lieux d'événements premium à Dakar",
    website: "https://dakar-venues.sn",
    contactEmail: "contact@dakar-venues.sn",
    phone: "+221770004321",
    country: "SN",
    city: "Dakar",
    plan: "starter",
    ownerId: IDS.venueManager,
    memberIds: [IDS.venueManager],
    isVerified: true,
  },
  {
    id: IDS.freeOrgId,
    name: "Startup Dakar",
    slug: "startup-dakar",
    description: "Petit collectif d'organisateurs de meetups tech à Dakar — plan gratuit",
    website: null,
    contactEmail: "contact@startup-dakar.sn",
    phone: "+221770005555",
    country: "SN",
    city: "Dakar",
    plan: "free",
    ownerId: IDS.freeOrganizer,
    memberIds: [IDS.freeOrganizer],
    isVerified: false,
  },
  {
    id: IDS.enterpriseOrgId,
    name: "Groupe Sonatel Events",
    slug: "sonatel-events",
    description: "Division événementielle du Groupe Sonatel — plan enterprise",
    website: "https://sonatel.sn",
    contactEmail: "events@sonatel.sn",
    phone: "+221770006666",
    country: "SN",
    city: "Dakar",
    plan: "enterprise",
    ownerId: IDS.enterpriseOrganizer,
    memberIds: [IDS.enterpriseOrganizer],
    isVerified: true,
  },
  {
    // PR B — starter-tier org located outside Dakar, gives the starter plan
    // real activity (previously only `org-002` carried that plan and it has
    // zero events, so every starter-specific UI surface showed empty states).
    id: IDS.starterOrgId,
    name: "Thiès Tech Collective",
    slug: "thies-tech-collective",
    description:
      "Collectif régional d'organisateurs tech basé à Thiès — workshops, conférences, meetups.",
    website: "https://thies-tech.sn",
    contactEmail: "contact@thies-tech.sn",
    phone: "+221770007777",
    country: "SN",
    city: "Thiès",
    plan: "starter",
    ownerId: IDS.starterOrganizer,
    memberIds: [IDS.starterOrganizer],
    isVerified: true,
  },
];

export async function seedOrganizations(db: Firestore): Promise<number> {
  await Promise.all(
    ORGS.map((org) =>
      db
        .collection("organizations")
        .doc(org.id)
        .set({
          ...org,
          logoURL: null,
          isActive: true,
          // Stagger createdAt so "recently added" sorts aren't a tie.
          createdAt: org.id === IDS.starterOrgId ? oneWeekAgo : twoDaysAgo,
          updatedAt: now,
        }),
    ),
  );
  return ORGS.length;
}
