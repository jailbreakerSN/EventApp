/**
 * Seed admin / freemium-coupon fixtures.
 *
 * This module covers six collections that were previously listed in
 * RESETTABLE_COLLECTIONS but had no seed writer (Sprint A audit
 * 2026-04-25, finding S1 — adjusted scope). Without fixtures, the
 * back-office admin surfaces (Sprint 4) and the plan-coupon flow
 * (Phase 7+) render empty in local dev and staging — making demos
 * harder than they need to be.
 *
 * Collections written here:
 *   - adminJobRuns          → operator job-execution history
 *   - announcements         → admin-authored banners (info / warn / critical)
 *   - couponRedemptions     → audit trail of plan-coupon usage
 *   - featureFlags          → platform-wide feature flags
 *   - planCoupons           → plan-level promo codes
 *
 * (Invites are seeded by 07-invites.ts; they were missing from
 * SEED_SCRIPT_FILES which made them appear orphaned in the
 * coverage report. That config drift is fixed in the same commit
 * that adds this module.)
 *
 * IDs are stable strings (`adminjob-run-NNN`, `flag-NNN`, …) so
 * follow-up modules can reference them without re-discovery. Every
 * write is idempotent (`set` on a known doc id) so reruns don't
 * duplicate.
 */

import type { Firestore } from "firebase-admin/firestore";

import { Dates } from "./config";
import { IDS } from "./ids";

const {
  now,
  fifteenMinutesAgo,
  oneHourAgo,
  yesterday,
  twoDaysAgo,
  oneWeekAgo,
  twoWeeksAgo,
  oneMonthAgo,
  inOneWeek,
  inOneMonth,
  inThreeMonths,
} = Dates;

// ─── Admin Job Runs ────────────────────────────────────────────────────────
// Mirrors the AdminJobRunSchema in @teranga/shared-types. Six rows:
// two succeeded, two running, two failed — gives the admin "Jobs"
// surface a non-trivial history out of the box.

interface AdminJobRunFixture {
  id: string;
  jobKey: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  triggeredBy: string;
  triggeredByDisplayName: string | null;
  triggeredByRole: string;
  input: Record<string, unknown> | null;
  triggeredAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  output: string | null;
  error:
    | { code: string; message: string; stack?: string | null }
    | null;
  requestId: string;
}

const ADMIN_JOB_RUNS: AdminJobRunFixture[] = [
  {
    id: "adminjob-run-001",
    jobKey: "regenerate-effective-plan-limits",
    status: "succeeded",
    triggeredBy: IDS.superAdmin,
    triggeredByDisplayName: "Mariama Sarr",
    triggeredByRole: "super_admin",
    input: null,
    triggeredAt: oneWeekAgo,
    startedAt: oneWeekAgo,
    completedAt: oneWeekAgo,
    durationMs: 1240,
    output: "Recomputed effectiveLimits for 4 organizations.",
    error: null,
    requestId: "req-seed-adminjob-001",
  },
  {
    id: "adminjob-run-002",
    jobKey: "expire-pending-invites",
    status: "succeeded",
    triggeredBy: IDS.superAdmin,
    triggeredByDisplayName: "Mariama Sarr",
    triggeredByRole: "super_admin",
    input: { dryRun: false },
    triggeredAt: twoDaysAgo,
    startedAt: twoDaysAgo,
    completedAt: twoDaysAgo,
    durationMs: 562,
    output: "Expired 3 invites older than 14 days.",
    error: null,
    requestId: "req-seed-adminjob-002",
  },
  {
    id: "adminjob-run-003",
    jobKey: "rebuild-firestore-usage-rollups",
    status: "running",
    triggeredBy: IDS.superAdmin,
    triggeredByDisplayName: "Mariama Sarr",
    triggeredByRole: "super_admin",
    input: { fromDate: oneMonthAgo, toDate: now },
    triggeredAt: fifteenMinutesAgo,
    startedAt: fifteenMinutesAgo,
    completedAt: null,
    durationMs: null,
    output: null,
    error: null,
    requestId: "req-seed-adminjob-003",
  },
  {
    id: "adminjob-run-004",
    jobKey: "send-test-notification",
    status: "running",
    triggeredBy: IDS.superAdmin,
    triggeredByDisplayName: "Mariama Sarr",
    triggeredByRole: "super_admin",
    input: { kind: "registration_confirmed", recipientUid: IDS.participant1 },
    triggeredAt: oneHourAgo,
    startedAt: oneHourAgo,
    completedAt: null,
    durationMs: null,
    output: null,
    error: null,
    requestId: "req-seed-adminjob-004",
  },
  {
    id: "adminjob-run-005",
    jobKey: "rebuild-effective-plan-limits",
    status: "failed",
    triggeredBy: IDS.superAdmin,
    triggeredByDisplayName: "Mariama Sarr",
    triggeredByRole: "super_admin",
    input: { organizationId: "org-deleted-stub" },
    triggeredAt: twoWeeksAgo,
    startedAt: twoWeeksAgo,
    completedAt: twoWeeksAgo,
    durationMs: 84,
    output: null,
    error: {
      code: "not-found",
      message: "Organization org-deleted-stub does not exist.",
      stack: null,
    },
    requestId: "req-seed-adminjob-005",
  },
  {
    id: "adminjob-run-006",
    jobKey: "purge-stale-impersonation-codes",
    status: "succeeded",
    triggeredBy: IDS.superAdmin,
    triggeredByDisplayName: "Mariama Sarr",
    triggeredByRole: "super_admin",
    input: null,
    triggeredAt: yesterday,
    startedAt: yesterday,
    completedAt: yesterday,
    durationMs: 312,
    output: "Purged 0 expired impersonation codes.",
    error: null,
    requestId: "req-seed-adminjob-006",
  },
];

// ─── Announcements ─────────────────────────────────────────────────────────

interface AnnouncementFixture {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  audience: "all" | "organizers" | "participants";
  publishedAt: string;
  expiresAt?: string;
  active: boolean;
  createdBy: string;
}

const ANNOUNCEMENTS: AnnouncementFixture[] = [
  {
    id: "announcement-001",
    title: "Bienvenue sur Teranga Events 🎉",
    body:
      "La nouvelle plateforme de gestion d'événements pour le Sénégal et l'Afrique de l'Ouest francophone. Créez votre premier événement gratuitement.",
    severity: "info",
    audience: "all",
    publishedAt: oneMonthAgo,
    expiresAt: inThreeMonths,
    active: true,
    createdBy: IDS.superAdmin,
  },
  {
    id: "announcement-002",
    title: "Maintenance prévue ce week-end",
    body:
      "La plateforme sera momentanément indisponible samedi de 03h00 à 04h00 GMT pour une mise à jour de sécurité. Aucune action requise de votre part.",
    severity: "warning",
    audience: "organizers",
    publishedAt: yesterday,
    expiresAt: inOneWeek,
    active: true,
    createdBy: IDS.superAdmin,
  },
  {
    id: "announcement-003",
    title: "Nouveau : paiement Wave intégré",
    body:
      "Les organisateurs Pro peuvent désormais accepter les paiements Wave. Configurez votre compte dans Organisation › Paiements.",
    severity: "info",
    audience: "organizers",
    publishedAt: twoWeeksAgo,
    expiresAt: inOneMonth,
    active: true,
    createdBy: IDS.superAdmin,
  },
  {
    id: "announcement-004",
    title: "Conditions d'utilisation mises à jour",
    body:
      "Nous avons mis à jour nos conditions le 15 mars 2026. Consultez le résumé des changements dans votre espace.",
    severity: "info",
    audience: "all",
    publishedAt: oneMonthAgo,
    expiresAt: yesterday, // expired — kept to exercise the "active+unexpired" filter
    active: true,
    createdBy: IDS.superAdmin,
  },
];

// ─── Plan Coupons ──────────────────────────────────────────────────────────

interface PlanCouponFixture {
  id: string;
  code: string;
  label: string | null;
  discountType: "percentage" | "fixed";
  discountValue: number;
  appliedPlanIds: string[] | null;
  appliedCycles: ("monthly" | "annual")[] | null;
  maxUses: number | null;
  maxUsesPerOrg: number | null;
  usedCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const PLAN_COUPONS: PlanCouponFixture[] = [
  {
    id: "coupon-launch-2026",
    code: "LAUNCH2026",
    label: "Lancement plateforme — 30% sur tous les plans, 6 mois",
    discountType: "percentage",
    discountValue: 30,
    appliedPlanIds: null, // every plan
    appliedCycles: null, // every cycle
    maxUses: 500,
    maxUsesPerOrg: 1,
    usedCount: 23,
    startsAt: oneMonthAgo,
    expiresAt: inThreeMonths,
    isActive: true,
    createdBy: IDS.superAdmin,
    createdAt: oneMonthAgo,
    updatedAt: oneMonthAgo,
  },
  {
    id: "coupon-pro-annual",
    code: "PRO-ANNUAL-50",
    label: "Pro annuel — 50% la première année",
    discountType: "percentage",
    discountValue: 50,
    appliedPlanIds: ["pro"],
    appliedCycles: ["annual"],
    maxUses: 100,
    maxUsesPerOrg: 1,
    usedCount: 7,
    startsAt: twoWeeksAgo,
    expiresAt: inOneMonth,
    isActive: true,
    createdBy: IDS.superAdmin,
    createdAt: twoWeeksAgo,
    updatedAt: twoWeeksAgo,
  },
  {
    id: "coupon-fixed-5000",
    code: "FIXED5000",
    label: "Réduction fixe 5 000 XOF — Starter mensuel",
    discountType: "fixed",
    discountValue: 5000,
    appliedPlanIds: ["starter"],
    appliedCycles: ["monthly"],
    maxUses: null, // illimité
    maxUsesPerOrg: 3,
    usedCount: 12,
    startsAt: oneWeekAgo,
    expiresAt: inOneMonth,
    isActive: true,
    createdBy: IDS.superAdmin,
    createdAt: oneWeekAgo,
    updatedAt: oneWeekAgo,
  },
  {
    id: "coupon-expired-demo",
    code: "EXPIRED-DEMO",
    label: "Démo coupon expiré — pour exercer la validation côté UI",
    discountType: "percentage",
    discountValue: 20,
    appliedPlanIds: null,
    appliedCycles: null,
    maxUses: 50,
    maxUsesPerOrg: 1,
    usedCount: 50, // capped
    startsAt: oneMonthAgo,
    expiresAt: yesterday,
    isActive: true, // but expired by date
    createdBy: IDS.superAdmin,
    createdAt: oneMonthAgo,
    updatedAt: yesterday,
  },
  {
    id: "coupon-disabled",
    code: "DISABLED-DEMO",
    label: "Coupon désactivé — exerce le rendu inactive",
    discountType: "percentage",
    discountValue: 15,
    appliedPlanIds: null,
    appliedCycles: null,
    maxUses: null,
    maxUsesPerOrg: null,
    usedCount: 0,
    startsAt: null,
    expiresAt: null,
    isActive: false,
    createdBy: IDS.superAdmin,
    createdAt: oneMonthAgo,
    updatedAt: oneMonthAgo,
  },
];

// ─── Coupon Redemptions ────────────────────────────────────────────────────

interface CouponRedemptionFixture {
  id: string;
  couponId: string;
  couponCode: string;
  organizationId: string;
  subscriptionId: string;
  planId: string;
  cycle?: "monthly" | "annual";
  discountType: "percentage" | "fixed";
  discountValue: number;
  originalPriceXof: number;
  discountAppliedXof: number;
  finalPriceXof: number;
  redeemedBy: string;
  redeemedAt: string;
}

// IMPORTANT — subscription → org map (from 06-social.ts:1457+):
//   sub-001 → venueOrgId    (Dakar Venues, starter)
//   sub-002 → orgId         (Teranga Events, pro)
//   sub-003 → enterpriseOrgId (Sonatel, enterprise)
//   sub-004 → starterOrgId  (Dakar Digital Hub, starter)
//   sub-005 → orgId         (Teranga Events, pro)
//   sub-006 → freeOrgId     (Startup Dakar, free)
//   sub-007 → enterpriseOrgId (Sonatel, enterprise)
// `subscriptionId` MUST belong to `organizationId`, otherwise the admin
// coupon-history drill-down renders scrambled rows. Plan IDs MUST match
// `seed-plans.ts` doc IDs (`free` | `starter` | `pro` | `enterprise`),
// not `plan-*` — `assertCouponApplies` does an `appliedPlanIds.includes(plan.id)`
// equality check (see plan-coupon.service.ts:488). `coupon-pro-annual` has
// `maxUsesPerOrg: 1` so we can only redeem it once per org — orgId is the
// only pro-tier org, so redemption-003 stays on orgId+sub-005 (different
// sub from redemption-001's sub-002).
const COUPON_REDEMPTIONS: CouponRedemptionFixture[] = [
  {
    id: "redemption-001",
    couponId: "coupon-launch-2026",
    couponCode: "LAUNCH2026",
    organizationId: IDS.orgId, // Teranga Events SRL (pro)
    subscriptionId: "sub-002", // pro sub for orgId
    planId: "pro",
    cycle: "monthly",
    discountType: "percentage",
    discountValue: 30,
    originalPriceXof: 29900,
    discountAppliedXof: 8970,
    finalPriceXof: 20930,
    redeemedBy: IDS.organizer,
    redeemedAt: twoWeeksAgo,
  },
  {
    id: "redemption-002",
    couponId: "coupon-launch-2026",
    couponCode: "LAUNCH2026",
    organizationId: IDS.venueOrgId, // Dakar Venues & Hospitality (starter)
    subscriptionId: "sub-001", // starter sub for venueOrgId
    planId: "starter",
    cycle: "annual",
    discountType: "percentage",
    discountValue: 30,
    originalPriceXof: 99000,
    discountAppliedXof: 29700,
    finalPriceXof: 69300,
    redeemedBy: IDS.venueManager,
    redeemedAt: oneWeekAgo,
  },
  {
    id: "redemption-003",
    couponId: "coupon-pro-annual",
    couponCode: "PRO-ANNUAL-50",
    organizationId: IDS.orgId, // Teranga Events SRL (pro) — only pro-tier org
    subscriptionId: "sub-005", // pro sub for orgId (different from redemption-001's sub-002)
    planId: "pro",
    cycle: "annual",
    discountType: "percentage",
    discountValue: 50,
    originalPriceXof: 299000,
    discountAppliedXof: 149500,
    finalPriceXof: 149500,
    redeemedBy: IDS.organizer,
    redeemedAt: twoDaysAgo,
  },
  {
    id: "redemption-004",
    couponId: "coupon-fixed-5000",
    couponCode: "FIXED5000",
    organizationId: IDS.starterOrgId, // Dakar Digital Hub (starter)
    subscriptionId: "sub-004", // starter sub for starterOrgId
    planId: "starter",
    cycle: "monthly",
    discountType: "fixed",
    discountValue: 5000,
    originalPriceXof: 9900,
    discountAppliedXof: 5000,
    finalPriceXof: 4900,
    redeemedBy: IDS.starterOrganizer,
    redeemedAt: yesterday,
  },
];

// ─── Feature Flags ─────────────────────────────────────────────────────────

interface FeatureFlagFixture {
  key: string;
  enabled: boolean;
  description: string | null;
  rolloutPercent: number;
  updatedAt: string;
  updatedBy: string;
}

const FEATURE_FLAGS: FeatureFlagFixture[] = [
  {
    key: "newsletter.opt-in-banner",
    enabled: true,
    description:
      "Affiche un bandeau d'opt-in newsletter sur le site participant après une première inscription.",
    rolloutPercent: 100,
    updatedAt: twoWeeksAgo,
    updatedBy: IDS.superAdmin,
  },
  {
    key: "checkin.offline-sync-v2",
    enabled: false,
    description:
      "Active la synchronisation offline check-in v2 (ECDH X25519). Désactivé tant que mobile Wave 9 n'est pas livré.",
    rolloutPercent: 0,
    updatedAt: oneMonthAgo,
    updatedBy: IDS.superAdmin,
  },
  {
    key: "feed.reactions",
    enabled: true,
    description: "Active les réactions emoji sur les posts du feed.",
    rolloutPercent: 100,
    updatedAt: oneMonthAgo,
    updatedBy: IDS.superAdmin,
  },
  {
    key: "messaging.attachments",
    enabled: true,
    description: "Permet l'envoi de pièces jointes (images) dans la messagerie.",
    rolloutPercent: 50,
    updatedAt: oneWeekAgo,
    updatedBy: IDS.superAdmin,
  },
  {
    key: "billing.coupons.public-validate",
    enabled: true,
    description:
      "Expose POST /v1/coupons/validate sans authentification (validation publique des codes promo).",
    rolloutPercent: 100,
    updatedAt: twoWeeksAgo,
    updatedBy: IDS.superAdmin,
  },
  {
    key: "experimental.ai-event-suggestions",
    enabled: false,
    description:
      "Suggestions d'événements via Anthropic Claude. Hors-portée MVP — flag présent pour la roadmap Wave 8.",
    rolloutPercent: 0,
    updatedAt: oneMonthAgo,
    updatedBy: IDS.superAdmin,
  },
];

// ─── Writers ───────────────────────────────────────────────────────────────

async function writeAdminJobRuns(db: Firestore): Promise<number> {
  const batch = db.batch();
  for (const fixture of ADMIN_JOB_RUNS) {
    batch.set(db.collection("adminJobRuns").doc(fixture.id), fixture);
  }
  await batch.commit();
  return ADMIN_JOB_RUNS.length;
}

async function writeAnnouncements(db: Firestore): Promise<number> {
  const batch = db.batch();
  for (const fixture of ANNOUNCEMENTS) {
    batch.set(db.collection("announcements").doc(fixture.id), fixture);
  }
  await batch.commit();
  return ANNOUNCEMENTS.length;
}

async function writePlanCoupons(db: Firestore): Promise<number> {
  const batch = db.batch();
  for (const fixture of PLAN_COUPONS) {
    batch.set(db.collection("planCoupons").doc(fixture.id), fixture);
  }
  await batch.commit();
  return PLAN_COUPONS.length;
}

async function writeCouponRedemptions(db: Firestore): Promise<number> {
  const batch = db.batch();
  for (const fixture of COUPON_REDEMPTIONS) {
    batch.set(db.collection("couponRedemptions").doc(fixture.id), fixture);
  }
  await batch.commit();
  return COUPON_REDEMPTIONS.length;
}

async function writeFeatureFlags(db: Firestore): Promise<number> {
  const batch = db.batch();
  for (const fixture of FEATURE_FLAGS) {
    batch.set(db.collection("featureFlags").doc(fixture.key), fixture);
  }
  await batch.commit();
  return FEATURE_FLAGS.length;
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

export interface AdminFixturesCounts {
  adminJobRuns: number;
  announcements: number;
  planCoupons: number;
  couponRedemptions: number;
  featureFlags: number;
}

export async function seedAdminFixtures(db: Firestore): Promise<AdminFixturesCounts> {
  // Plan coupons must land before redemptions (which reference them by
  // id), so sequence those two. The other writes have no referential
  // dependencies and fan out in parallel.
  const planCouponsCount = await writePlanCoupons(db);
  const [
    adminJobRunsCount,
    announcementsCount,
    couponRedemptionsCount,
    featureFlagsCount,
  ] = await Promise.all([
    writeAdminJobRuns(db),
    writeAnnouncements(db),
    writeCouponRedemptions(db),
    writeFeatureFlags(db),
  ]);
  return {
    adminJobRuns: adminJobRunsCount,
    announcements: announcementsCount,
    planCoupons: planCouponsCount,
    couponRedemptions: couponRedemptionsCount,
    featureFlags: featureFlagsCount,
  };
}
