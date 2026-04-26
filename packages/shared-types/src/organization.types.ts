import { z } from "zod";

export const OrganizationPlanSchema = z.enum([
  "free", // up to 2 events/month, 100 participants
  "starter", // up to 10 events/month, 500 participants
  "pro", // unlimited events, 5000 participants
  "enterprise", // unlimited, white-label, custom branding
]);

export type OrganizationPlan = z.infer<typeof OrganizationPlanSchema>;

export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string().min(2).max(150),
  slug: z.string().regex(/^[a-z0-9-]+$/), // URL-friendly identifier
  logoURL: z.string().url().nullable().optional(),
  coverURL: z.string().url().nullable().optional(),
  website: z.string().url().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  country: z.string().length(2).default("SN"), // ISO 3166-1 alpha-2
  city: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  plan: OrganizationPlanSchema.default("free"),
  ownerId: z.string(), // Firebase UID of the owner/super-organizer
  memberIds: z.array(z.string()).default([]), // Firebase UIDs of members
  isVerified: z.boolean().default(false), // KYB verification
  isActive: z.boolean().default(true),
  // ── Effective plan denormalization (Phase 2+) ─────────────────────────────
  // The effective limits/features that enforcement code reads. Resolved from
  // the plan catalog entry referenced by the org's subscription, optionally
  // overridden per-subscription. Kept on the org doc so security rules and
  // hot-path code can read them synchronously in a single doc fetch.
  // Optional during Phase 2 migration — Phase 3 switches enforcement to read
  // these and makes them authoritative.
  effectiveLimits: z
    .object({
      maxEvents: z.number().int(),
      maxParticipantsPerEvent: z.number().int(),
      maxMembers: z.number().int(),
    })
    .optional(),
  effectiveFeatures: z
    .object({
      qrScanning: z.boolean(),
      paidTickets: z.boolean(),
      customBadges: z.boolean(),
      csvExport: z.boolean(),
      smsNotifications: z.boolean(),
      advancedAnalytics: z.boolean(),
      speakerPortal: z.boolean(),
      sponsorPortal: z.boolean(),
      apiAccess: z.boolean(),
      whiteLabel: z.boolean(),
      promoCodes: z.boolean(),
      // B2 follow-up — waitlist gating. Optional to keep the
      // contract snapshot stable for orgs whose denorm hasn't been
      // re-projected since the field was added; the resolver fills
      // it in on the next plan write. Default-false at the API
      // layer matches free-tier expectation; starter+ ships true.
      waitlist: z.boolean().optional(),
    })
    .optional(),
  effectivePlanKey: z.string().optional(),
  effectiveComputedAt: z.string().datetime().optional(),
  // ── Unified entitlement model (Phase 7+ item #2) ──────────────────────────
  // Denormalized entitlement map for hot-path reads by the new
  // `requireEntitlement` / `checkQuota` helpers. Populated alongside
  // effectiveLimits / effectiveFeatures when the underlying plan uses the
  // unified model; absent for plans on the legacy (features + limits) path.
  //
  // Intentionally typed as a loose `Record<string, unknown>` instead of
  // `EntitlementMapSchema`: this is a DENORM field — values were already
  // validated at write-time on `PlanSchema.entitlements`. Keeping the
  // read-side shape loose here (a) avoids the contract snapshot paying
  // the cost of the full discriminated-union serialization on every
  // read-path, and (b) keeps this file free of plan.types dependencies.
  // The write path (`toStoredSnapshot` → `effectiveEntitlements: stored.entitlements`)
  // is typed as `EntitlementMap` and carries the full validation.
  //
  // Legacy enforcement reads `effectiveLimits` / `effectiveFeatures`; new
  // enforcement reads this field when present and falls back to the legacy
  // fields otherwise. See docs/delivery-plan/entitlement-model-design.md.
  effectiveEntitlements: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Organization = z.infer<typeof OrganizationSchema>;

export const CreateOrganizationSchema = OrganizationSchema.omit({
  id: true,
  ownerId: true,
  memberIds: true,
  isVerified: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateOrganizationDto = z.infer<typeof CreateOrganizationSchema>;

export const UpdateOrganizationSchema = CreateOrganizationSchema.partial().omit({
  slug: true, // slug is immutable
});

export type UpdateOrganizationDto = z.infer<typeof UpdateOrganizationSchema>;

// ─── Organization Member Role ────────────────────────────────────────────────

export const OrgMemberRoleSchema = z.enum([
  "owner", // full control, can delete org
  "admin", // manage events, members, settings — cannot delete org
  "member", // create/manage own events, view analytics
  "viewer", // read-only access to org dashboard
]);

export type OrgMemberRole = z.infer<typeof OrgMemberRoleSchema>;

export const OrgMemberSchema = z.object({
  userId: z.string(),
  role: OrgMemberRoleSchema,
  displayName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  joinedAt: z.string().datetime(),
});

export type OrgMember = z.infer<typeof OrgMemberSchema>;

// ─── Organization Invite ────────────────────────────────────────────────────

export const InviteStatusSchema = z.enum(["pending", "accepted", "declined", "expired"]);
export type InviteStatus = z.infer<typeof InviteStatusSchema>;

export const OrganizationInviteSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  email: z.string().email(),
  role: OrgMemberRoleSchema,
  status: InviteStatusSchema.default("pending"),
  invitedBy: z.string(),
  invitedByName: z.string().nullable().optional(),
  token: z.string(), // unique invite token
  respondedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OrganizationInvite = z.infer<typeof OrganizationInviteSchema>;

export const CreateInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "viewer"]).default("member"), // owner cannot be assigned via invite
});

export type CreateInviteDto = z.infer<typeof CreateInviteSchema>;

// ─── Admin Invite Query ────────────────────────────────────────────────────
//
// Cross-org invite listing behind `platform:manage`. Drives `/admin/invites`
// and the "X invitations expirées" inbox deep-link. The public invites
// routes are org-scoped (see `invites.routes.ts`); this schema widens the
// read surface to every org for platform-ops cleanup / relance flows.
//
// `orderBy` is deliberately not exposed: the repository's paginated helper
// defaults to `createdAt DESC`, which matches the static-analysis audit in
// `scripts/audit-firestore-indexes.ts`. Same rationale as the admin
// payments / subscriptions schemas.

export const AdminInviteQuerySchema = z.object({
  status: InviteStatusSchema.optional(),
  organizationId: z.string().optional(),
  role: OrgMemberRoleSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type AdminInviteQuery = z.infer<typeof AdminInviteQuerySchema>;

// ─── Analytics ──────────────────────────────────────────────────────────────

export const AnalyticsTimeframeSchema = z.enum(["7d", "30d", "90d", "12m", "all"]);
export type AnalyticsTimeframe = z.infer<typeof AnalyticsTimeframeSchema>;

export const AnalyticsQuerySchema = z.object({
  timeframe: AnalyticsTimeframeSchema.default("30d"),
  eventId: z.string().optional(), // filter to a single event
});

export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

export const TimeSeriesPointSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  count: z.number().int(),
});

export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;

export const OrgAnalyticsSchema = z.object({
  organizationId: z.string(),
  timeframe: AnalyticsTimeframeSchema,
  summary: z.object({
    totalEvents: z.number().int(),
    totalRegistrations: z.number().int(),
    totalCheckedIn: z.number().int(),
    totalCancelled: z.number().int(),
    checkinRate: z.number(), // 0-1
  }),
  registrationsOverTime: z.array(TimeSeriesPointSchema),
  checkinsOverTime: z.array(TimeSeriesPointSchema),
  byCategory: z.array(
    z.object({
      category: z.string(),
      count: z.number().int(),
    }),
  ),
  byTicketType: z.array(
    z.object({
      ticketTypeName: z.string(),
      registered: z.number().int(),
      checkedIn: z.number().int(),
    }),
  ),
  topEvents: z.array(
    z.object({
      eventId: z.string(),
      title: z.string(),
      registeredCount: z.number().int(),
      checkedInCount: z.number().int(),
    }),
  ),
});

export type OrgAnalytics = z.infer<typeof OrgAnalyticsSchema>;

// ─── Plan Limits (single source of truth) ────────────────────────────────────
// Used by API for enforcement and by frontends for plan feature display.
// Infinity means unlimited — frontends should check with isFinite().

export interface PlanFeatures {
  qrScanning: boolean;
  paidTickets: boolean;
  customBadges: boolean;
  csvExport: boolean;
  smsNotifications: boolean;
  advancedAnalytics: boolean;
  speakerPortal: boolean;
  sponsorPortal: boolean;
  apiAccess: boolean;
  whiteLabel: boolean;
  promoCodes: boolean;
  /**
   * B2 follow-up — when `true`, the API will route over-capacity
   * registrations to `status: "waitlisted"` (instead of throwing
   * `EventFullError`) on events with `requiresApproval: true`. Free
   * plan ships `false` so sold-out events are an obvious upgrade
   * trigger; starter+ enables it. Reads via the `effectiveFeatures`
   * snapshot on the org doc — `requirePlanFeature(org, "waitlist")`
   * is the canonical gate.
   *
   * Optional on the interface to keep legacy fixtures + denorm
   * snapshots compatible — every reader uses `feature.waitlist === true`
   * (truthy compare) so undefined is treated as `false` (the safe
   * default that matches the free-tier value).
   */
  waitlist?: boolean;
  /**
   * Phase O6 — gates the WhatsApp Business API channel. Free + starter
   * tiers ship without it (Meta charges per template, broadcast volume
   * matters for unit economics); pro + enterprise unlock the channel
   * end-to-end (composer toggle, lifecycle dispatcher route, opt-in
   * banner). Optional on the interface for the same backward-compat
   * reasons as `waitlist`.
   */
  whatsappNotifications?: boolean;
}

export type PlanFeature = keyof PlanFeatures;

export interface PlanLimits {
  maxEvents: number; // active events (draft + published)
  maxParticipantsPerEvent: number; // per-event registration cap
  maxMembers: number;
  features: PlanFeatures;
}

const FREE_FEATURES: PlanFeatures = {
  qrScanning: false,
  paidTickets: false,
  customBadges: false,
  csvExport: false,
  smsNotifications: false,
  advancedAnalytics: false,
  speakerPortal: false,
  sponsorPortal: false,
  apiAccess: false,
  whiteLabel: false,
  promoCodes: false,
  // B2 follow-up — free tier gets the hard "Complet" wall on full
  // events. Sold-out is an obvious upgrade trigger; the waitlist
  // surface (FIFO promotion + email notification on opening) is
  // a starter+ value-add.
  waitlist: false,
};

const STARTER_FEATURES: PlanFeatures = {
  qrScanning: true,
  paidTickets: false,
  customBadges: true,
  csvExport: true,
  smsNotifications: false,
  advancedAnalytics: false,
  speakerPortal: false,
  sponsorPortal: false,
  apiAccess: false,
  whiteLabel: false,
  promoCodes: true,
  waitlist: true,
};

const PRO_FEATURES: PlanFeatures = {
  qrScanning: true,
  paidTickets: true,
  customBadges: true,
  csvExport: true,
  smsNotifications: true,
  advancedAnalytics: true,
  speakerPortal: true,
  sponsorPortal: true,
  apiAccess: false,
  whiteLabel: false,
  promoCodes: true,
  waitlist: true,
  // Phase O6 — WhatsApp Business unlocked for Pro+ (per-message
  // pricing makes the channel viable only above starter volumes).
  whatsappNotifications: true,
};

const ENTERPRISE_FEATURES: PlanFeatures = {
  qrScanning: true,
  paidTickets: true,
  customBadges: true,
  csvExport: true,
  smsNotifications: true,
  advancedAnalytics: true,
  speakerPortal: true,
  sponsorPortal: true,
  apiAccess: true,
  whiteLabel: true,
  promoCodes: true,
  waitlist: true,
  whatsappNotifications: true,
};

/**
 * @deprecated Phase 6 (Apr 2026): the catalog of plans is now stored in the
 *   `plans` Firestore collection and managed by superadmins. Enforcement
 *   reads `org.effectiveLimits` (denormalized at write time, see Phase 2/3),
 *   the API's `BaseService.checkPlanLimit()` accepts an org and falls back
 *   to this table only when an org predates the Phase 2 backfill, and the
 *   web client reads from `usePlansCatalog()` / `getPlanDisplay()`. Keep
 *   this constant exported as the canonical seed source for `seed-plans.ts`
 *   and as a final fallback in the API and tests.
 *   New code should NOT import this directly — use the catalog.
 */
export const PLAN_LIMITS: Record<OrganizationPlan, PlanLimits> = {
  free: { maxEvents: 3, maxParticipantsPerEvent: 50, maxMembers: 1, features: FREE_FEATURES },
  starter: {
    maxEvents: 10,
    maxParticipantsPerEvent: 200,
    maxMembers: 3,
    features: STARTER_FEATURES,
  },
  pro: {
    maxEvents: Infinity,
    maxParticipantsPerEvent: 2000,
    maxMembers: 50,
    features: PRO_FEATURES,
  },
  enterprise: {
    maxEvents: Infinity,
    maxParticipantsPerEvent: Infinity,
    maxMembers: Infinity,
    features: ENTERPRISE_FEATURES,
  },
};

export interface PlanDisplayInfo {
  id: OrganizationPlan;
  name: { fr: string; en: string };
  priceXof: number;
  limits: PlanLimits;
}

/**
 * @deprecated Phase 6: see PLAN_LIMITS deprecation note. Web clients should
 *   call `usePlansCatalog()` and pass the resolved map to `getPlanDisplay()`
 *   so custom superadmin-created plans render correctly. Kept exported as
 *   the seed source for the catalog (system plans) and as a UI fallback
 *   when the catalog hasn't yet loaded on a cold page render.
 */
export const PLAN_DISPLAY: Record<OrganizationPlan, PlanDisplayInfo> = {
  free: {
    id: "free",
    name: { fr: "Teranga Libre", en: "Teranga Free" },
    priceXof: 0,
    limits: PLAN_LIMITS.free,
  },
  starter: {
    id: "starter",
    name: { fr: "Teranga Starter", en: "Teranga Starter" },
    priceXof: 9900,
    limits: PLAN_LIMITS.starter,
  },
  pro: {
    id: "pro",
    name: { fr: "Teranga Pro", en: "Teranga Pro" },
    priceXof: 29900,
    limits: PLAN_LIMITS.pro,
  },
  enterprise: {
    id: "enterprise",
    name: { fr: "Teranga Enterprise", en: "Teranga Enterprise" },
    priceXof: 0,
    limits: PLAN_LIMITS.enterprise,
  },
};
