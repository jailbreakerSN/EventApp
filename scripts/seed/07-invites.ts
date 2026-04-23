/**
 * Seed organization invite fixtures.
 *
 * The `invites` collection was never seeded before this refresh, leaving the
 * onboarding member workflow (pending / accepted / declined / expired) with
 * no visible data in staging. This module plants a small but diverse set of
 * invites spanning multiple orgs, all roles, and all lifecycle states so
 * product can demonstrate the invite UI end-to-end.
 *
 * Roles reference `OrgMemberRoleSchema` = "owner" | "admin" | "member" |
 * "viewer". Owner is never seeded here (system plans cannot invite a new
 * owner). Tokens are deterministic placeholders (`invite-token-<id>`) — the
 * real flow mints a secure token via crypto.randomUUID() + hashing.
 *
 * Dates use the `Dates` offsets from ./config so the same fixtures stay
 * chronologically valid across seed runs: pending expires in +2 weeks,
 * expired has expiresAt in the past, responded invites carry respondedAt.
 */

import type { Firestore } from "firebase-admin/firestore";

import { Dates } from "./config";
import { IDS } from "./ids";

const { now, yesterday, twoDaysAgo, oneWeekAgo, oneMonthAgo, inTwoWeeks, inOneMonth } = Dates;

type SeedInvite = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: "admin" | "member" | "viewer";
  status: "pending" | "accepted" | "declined" | "expired";
  invitedBy: string;
  invitedByName: string | null;
  token: string;
  respondedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

const INVITES: SeedInvite[] = [
  // ── org-001 (Teranga Events, pro) — active growth ─────────────────────
  {
    id: "invite-001",
    organizationId: IDS.orgId,
    organizationName: "Teranga Events",
    email: "nouveau.membre@teranga.dev",
    role: "member",
    status: "pending",
    invitedBy: IDS.organizer,
    invitedByName: "Moussa Diop",
    token: "invite-token-001",
    respondedAt: null,
    expiresAt: inTwoWeeks,
    createdAt: yesterday,
    updatedAt: yesterday,
  },
  {
    id: "invite-002",
    organizationId: IDS.orgId,
    organizationName: "Teranga Events",
    email: "admin.nouveau@teranga.dev",
    role: "admin",
    status: "pending",
    invitedBy: IDS.organizer,
    invitedByName: "Moussa Diop",
    token: "invite-token-002",
    respondedAt: null,
    expiresAt: inOneMonth,
    createdAt: twoDaysAgo,
    updatedAt: twoDaysAgo,
  },
  {
    id: "invite-003",
    organizationId: IDS.orgId,
    organizationName: "Teranga Events",
    email: "viewer.analytics@teranga.dev",
    role: "viewer",
    status: "accepted",
    invitedBy: IDS.organizer,
    invitedByName: "Moussa Diop",
    token: "invite-token-003",
    respondedAt: oneWeekAgo,
    expiresAt: inOneMonth,
    createdAt: twoDaysAgo,
    updatedAt: oneWeekAgo,
  },
  // ── org-005 (Thiès Tech Collective, starter) — starter growth ─────────
  {
    id: "invite-004",
    organizationId: IDS.starterOrgId,
    organizationName: "Thiès Tech Collective",
    email: "codev.thies@teranga.dev",
    role: "member",
    status: "pending",
    invitedBy: IDS.starterOrganizer,
    invitedByName: "Oumar Ba",
    token: "invite-token-004",
    respondedAt: null,
    expiresAt: inTwoWeeks,
    createdAt: yesterday,
    updatedAt: yesterday,
  },
  {
    id: "invite-005",
    organizationId: IDS.starterOrgId,
    organizationName: "Thiès Tech Collective",
    email: "ex.volontaire@teranga.dev",
    role: "member",
    status: "declined",
    invitedBy: IDS.starterOrganizer,
    invitedByName: "Oumar Ba",
    token: "invite-token-005",
    respondedAt: yesterday,
    expiresAt: inTwoWeeks,
    createdAt: twoDaysAgo,
    updatedAt: yesterday,
  },
  // ── org-003 (Startup Dakar, free) — hits plan-limit on acceptance ─────
  {
    id: "invite-006",
    organizationId: IDS.freeOrgId,
    organizationName: "Startup Dakar",
    email: "refuse.plan-limit@teranga.dev",
    role: "member",
    status: "pending",
    invitedBy: IDS.freeOrganizer,
    invitedByName: "Samba Sarr",
    token: "invite-token-006",
    respondedAt: null,
    expiresAt: inTwoWeeks,
    createdAt: now,
    updatedAt: now,
  },
  // ── org-002 (Dakar Venues, starter) — expired, should be cleaned up ───
  {
    id: "invite-007",
    organizationId: IDS.venueOrgId,
    organizationName: "Dakar Venues & Hospitality",
    email: "oublie.invite@teranga.dev",
    role: "viewer",
    status: "expired",
    invitedBy: IDS.venueManager,
    invitedByName: "Fatoumata Ndiaye",
    token: "invite-token-007",
    respondedAt: null,
    // Past expiry (~3 weeks ago)
    expiresAt: oneMonthAgo,
    createdAt: oneMonthAgo,
    updatedAt: oneMonthAgo,
  },
  // ── org-004 (Sonatel Events, enterprise) — multiple pending ───────────
  {
    id: "invite-008",
    organizationId: IDS.enterpriseOrgId,
    organizationName: "Groupe Sonatel Events",
    email: "ops.lead@sonatel.sn",
    role: "admin",
    status: "pending",
    invitedBy: IDS.enterpriseOrganizer,
    invitedByName: "Cheikh Diallo",
    token: "invite-token-008",
    respondedAt: null,
    expiresAt: inOneMonth,
    createdAt: yesterday,
    updatedAt: yesterday,
  },
  {
    id: "invite-009",
    organizationId: IDS.enterpriseOrgId,
    organizationName: "Groupe Sonatel Events",
    email: "finance.analyst@sonatel.sn",
    role: "viewer",
    status: "pending",
    invitedBy: IDS.enterpriseOrganizer,
    invitedByName: "Cheikh Diallo",
    token: "invite-token-009",
    respondedAt: null,
    expiresAt: inOneMonth,
    createdAt: yesterday,
    updatedAt: yesterday,
  },
  {
    id: "invite-010",
    organizationId: IDS.enterpriseOrgId,
    organizationName: "Groupe Sonatel Events",
    email: "moderator@sonatel.sn",
    role: "member",
    status: "accepted",
    invitedBy: IDS.enterpriseOrganizer,
    invitedByName: "Cheikh Diallo",
    token: "invite-token-010",
    respondedAt: twoDaysAgo,
    expiresAt: inOneMonth,
    createdAt: oneWeekAgo,
    updatedAt: twoDaysAgo,
  },
];

export async function seedInvites(db: Firestore): Promise<number> {
  await Promise.all(INVITES.map((inv) => db.collection("invites").doc(inv.id).set(inv)));
  return INVITES.length;
}
