import { z } from "zod";
import { zStringBoolean } from "./utils/zod";

// ─── Venue Enums ────────────────────────────────────────────────────────────

export const VenueTypeSchema = z.enum([
  "hotel",
  "conference_center",
  "cultural_space",
  "coworking",
  "restaurant",
  "outdoor",
  "university",
  "sports",
  "other",
]);

export type VenueType = z.infer<typeof VenueTypeSchema>;

export const VenueStatusSchema = z.enum(["pending", "approved", "suspended", "archived"]);

export type VenueStatus = z.infer<typeof VenueStatusSchema>;

// ─── Venue Address ──────────────────────────────────────────────────────────

export const VenueAddressSchema = z.object({
  street: z.string().min(1).max(300),
  city: z.string().min(1).max(100),
  region: z.string().max(100).nullable().optional(),
  country: z.string().length(2).default("SN"),
  coordinates: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
});

export type VenueAddress = z.infer<typeof VenueAddressSchema>;

// ─── Capacity Configuration ─────────────────────────────────────────────────

export const CapacityConfigurationSchema = z.object({
  name: z.string().min(1).max(100), // e.g. "Théâtre", "Classe", "Cocktail"
  capacity: z.number().int().positive(),
});

export type CapacityConfiguration = z.infer<typeof CapacityConfigurationSchema>;

// ─── Venue ──────────────────────────────────────────────────────────────────

export const VenueSchema = z.object({
  id: z.string(),
  name: z.string().min(2).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().max(5000).nullable().optional(),
  address: VenueAddressSchema,
  venueType: VenueTypeSchema,
  capacity: z
    .object({
      min: z.number().int().positive().nullable().optional(),
      max: z.number().int().positive().nullable().optional(),
      configurations: z.array(CapacityConfigurationSchema).default([]),
    })
    .nullable()
    .optional(),
  amenities: z.array(z.string()).default([]),
  photos: z.array(z.string().url()).default([]),
  contactName: z.string().min(1).max(200),
  contactEmail: z.string().email(),
  contactPhone: z.string().nullable().optional(),
  website: z.string().url().nullable().optional(),
  hostOrganizationId: z.string().nullable().optional(),
  status: VenueStatusSchema.default("pending"),
  isFeatured: z.boolean().default(false),
  rating: z.number().min(0).max(5).nullable().optional(),
  eventCount: z.number().int().default(0),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Venue = z.infer<typeof VenueSchema>;

// ─── Create / Update DTOs ───────────────────────────────────────────────────

export const CreateVenueSchema = VenueSchema.omit({
  id: true,
  slug: true,
  status: true,
  isFeatured: true,
  rating: true,
  eventCount: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateVenueDto = z.infer<typeof CreateVenueSchema>;

export const UpdateVenueSchema = CreateVenueSchema.partial().omit({
  hostOrganizationId: true,
});

export type UpdateVenueDto = z.infer<typeof UpdateVenueSchema>;

// ─── Venue Query ────────────────────────────────────────────────────────────

export const VenueQuerySchema = z.object({
  q: z.string().max(200).optional(),
  city: z.string().optional(),
  country: z.string().length(2).optional(),
  venueType: VenueTypeSchema.optional(),
  status: VenueStatusSchema.optional(),
  isFeatured: zStringBoolean().optional(),
  mine: zStringBoolean().optional(), // filter to host's own venues
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  orderBy: z.enum(["name", "createdAt", "eventCount"]).default("name"),
  orderDir: z.enum(["asc", "desc"]).default("asc"),
});

export type VenueQuery = z.infer<typeof VenueQuerySchema>;

// ─── Admin Query Schemas ────────────────────────────────────────────────────

export const AdminUserQuerySchema = z.object({
  q: z.string().max(200).optional(),
  role: z.string().optional(),
  isActive: zStringBoolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  /**
   * Per-route sort whitelist (data-listing doctrine § Backend primitives).
   * Only fields backed by a Firestore index are accepted; anything else
   * yields a 400 from Zod.
   */
  orderBy: z.enum(["createdAt", "displayName", "email"]).optional(),
  orderDir: z.enum(["asc", "desc"]).optional(),
});

export type AdminUserQuery = z.infer<typeof AdminUserQuerySchema>;

// ─── Admin user row with JWT / Firestore drift detection ────────────────────
//
// The /admin/users table reads from the Firestore `users` doc while all
// authorization on the API side reads from JWT custom claims. In normal
// operation the two stay in sync (PR #64/#65 close every write-side
// drift vector). A tail-latency / failed-rollback window could still
// produce a divergence — in which case the admin needs to see a signal
// rather than apply a mutation that "looks right in the UI but targets
// stale state."
//
// `claimsMatch` is populated by the admin-list endpoint: it fetches each
// row's Auth record alongside the Firestore doc and reports whether the
// two agree on roles / organizationId / orgRole.
//
// When `claimsMatch == null`, the Auth record couldn't be fetched (user
// deleted in Auth but doc lingers, or Admin SDK transient failure). UI
// treats null as a soft warning — same color as drift, different copy.

export const ClaimsMatchSchema = z.object({
  roles: z.boolean(),
  organizationId: z.boolean(),
  orgRole: z.boolean(),
});

export type ClaimsMatch = z.infer<typeof ClaimsMatchSchema>;

export const AdminUserRowSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  photoURL: z.string().url().nullable().optional(),
  phone: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  roles: z.array(z.string()),
  organizationId: z.string().nullable().optional(),
  orgRole: z.string().nullable().optional(),
  preferredLanguage: z.enum(["fr", "en", "wo"]).optional(),
  isEmailVerified: z.boolean().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** null = Auth record couldn't be fetched. object = per-field agreement. */
  claimsMatch: ClaimsMatchSchema.nullable(),
});

export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

export const AdminOrgQuerySchema = z.object({
  q: z.string().max(200).optional(),
  plan: z.string().optional(),
  isVerified: zStringBoolean().optional(),
  isActive: zStringBoolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type AdminOrgQuery = z.infer<typeof AdminOrgQuerySchema>;

/**
 * Admin venue listing — mirrors `VenueQuerySchema` but lives behind
 * the `platform:manage` gate, so it can surface every status (including
 * `pending`, `suspended`, `archived`) without leaking moderation state
 * to public callers. The public `/v1/venues` endpoint stays
 * approved-only by design.
 */
export const AdminVenueQuerySchema = z.object({
  q: z.string().max(200).optional(),
  city: z.string().optional(),
  country: z.string().length(2).optional(),
  venueType: VenueTypeSchema.optional(),
  status: VenueStatusSchema.optional(),
  isFeatured: zStringBoolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  orderBy: z.enum(["name", "createdAt", "eventCount"]).default("createdAt"),
  orderDir: z.enum(["asc", "desc"]).default("desc"),
});

export type AdminVenueQuery = z.infer<typeof AdminVenueQuerySchema>;

export const AdminEventQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.string().optional(),
  organizationId: z.string().optional(),
  // Filters for the recurring-events admin surface (Phase 7+ B1
  // closure). Mutually-exclusive in practice but the schema does
  // NOT enforce that — `isRecurringParent=true` returns parent
  // anchors, `parentEventId=<id>` returns the children of one
  // series. Sending both yields children of that series only,
  // which is harmless: parents always carry parentEventId=null.
  // `parentEventId` is bounded at 128 chars (Firestore document-id
  // ceiling) so an attacker can't pump arbitrary-length strings
  // through the query planner.
  isRecurringParent: zStringBoolean().optional(),
  parentEventId: z.string().max(128).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type AdminEventQuery = z.infer<typeof AdminEventQuerySchema>;

// ─── Date-range coercer (Phase D — staging 400 hotfix) ─────────────────────
// The admin audit-log filters UI sends `dateFrom` / `dateTo` as date-only
// strings (`"2026-04-20"`) from a native <input type="date">. Zod's
// `.datetime()` validator expects the full ISO 8601 shape with time
// (`"2026-04-20T00:00:00.000Z"`), so the raw .datetime() check rejected
// those values with a 400 at the route layer before the service ever ran.
//
// Accept both shapes:
//   - full ISO datetime → passes through unchanged
//   - date-only "YYYY-MM-DD" → normalize to start/end of the day in UTC
//     (dateFrom → T00:00:00Z, dateTo → T23:59:59.999Z) before handing to
//     the repository.
// The coercion happens in `.transform()` so downstream consumers always see
// a canonical full ISO datetime.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const coerceAuditDate = (boundary: "start" | "end") =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined;
      if (DATE_ONLY.test(raw)) {
        return boundary === "start" ? `${raw}T00:00:00.000Z` : `${raw}T23:59:59.999Z`;
      }
      // Defer to .datetime() — fail with the same error surface we used
      // before so callers already sending ISO datetimes keep working.
      const result = z.string().datetime().safeParse(raw);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expected ISO 8601 datetime or YYYY-MM-DD date.",
        });
        return z.NEVER;
      }
      return result.data;
    });

export const AdminAuditQuerySchema = z.object({
  action: z.string().optional(),
  actorId: z.string().optional(),
  resourceType: z.string().optional(),
  /**
   * T2.6 — free-text search over the audit-log details JSON.
   * The implementation fetches a wider candidate page then filters
   * in-memory by substring against a deterministic projection of the
   * row. Accepts a maximum of 100 chars — longer queries are almost
   * certainly typos and bounding the input prevents pathological
   * CPU-time scans.
   */
  search: z.string().trim().min(1).max(100).optional(),
  /**
   * T2.6 — optional resourceId filter so clicking a row in a detail
   * page can deep-link into "all audit events for X" without extra
   * parsing. Required-if-resourceType for UX clarity (the API itself
   * accepts either alone).
   */
  resourceId: z.string().optional(),
  /**
   * T2.6 — organizationId filter. Complements resourceType=org so
   * platform admins can scope audit queries to a single tenant (e.g.
   * "everything that happened in org-123"). Applies regardless of
   * resourceType; the repository ANDs the filter in.
   */
  organizationId: z.string().optional(),
  dateFrom: coerceAuditDate("start"),
  dateTo: coerceAuditDate("end"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(50),
});

export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;

// ─── Admin Mutation Schemas ─────────────────────────────────────────────────

export const UpdateUserRolesSchema = z.object({
  roles: z.array(z.string()).min(1),
});

export type UpdateUserRolesDto = z.infer<typeof UpdateUserRolesSchema>;

export const UpdateUserStatusSchema = z.object({
  isActive: z.boolean(),
});

export type UpdateUserStatusDto = z.infer<typeof UpdateUserStatusSchema>;

// ─── Bulk status update (T1.2 — admin bulk selection) ────────────────────────
// Accepted by `POST /v1/admin/users/bulk-update-status` and
// `POST /v1/admin/organizations/bulk-update-status`. Capped at 100 IDs
// per request to keep audit-log fan-out bounded and keep the request
// within Cloud Run's 1 MB body limit with generous margin.

export const BulkUpdateStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  isActive: z.boolean(),
});

export type BulkUpdateStatusDto = z.infer<typeof BulkUpdateStatusSchema>;

/**
 * Response shape for bulk-status endpoints. Callers receive a per-item
 * result so the UI can render a summary ("12 succeeded, 1 failed:
 * <reason>"). Each failure carries the typed reason that came out of
 * the service layer so copy can disambiguate permission / not-found /
 * transactional conflict without re-fetching.
 */
export const BulkUpdateStatusResultSchema = z.object({
  succeeded: z.array(z.string()),
  failed: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
    }),
  ),
});

export type BulkUpdateStatusResult = z.infer<typeof BulkUpdateStatusResultSchema>;

// ─── Platform Stats ─────────────────────────────────────────────────────────

export interface PlatformStats {
  totalUsers: number;
  totalOrganizations: number;
  totalEvents: number;
  totalRegistrations: number;
  totalRevenue: number;
  activeVenues: number;
}

// ─── Plan Analytics (Phase 7+ item #5) ──────────────────────────────────────
// Superadmin dashboard snapshot. Computed on-demand from live subscriptions
// + organizations — no caching, no pre-aggregation, no snapshotting job.
// A point-in-time view is enough for the superadmin's decision-making use
// case (who's near a limit? how many on pro vs enterprise? trials ending
// this week?). Historical time-series is deferred until BigQuery export.
//
// Design calls (per the Plan-agent review of the feature spec):
//   - MRR normalises annual subs as priceXof / 12 so the tile compares
//     apples to apples. Separate `bookings` field exposes the raw cash
//     recognition for the same period — different business question.
//   - `trialingMRR` is the pipeline — what we'd collect if every current
//     trial converts. Held separate from `mrr` so conversion rate math is
//     trivial later.
//   - Tier mix groups by `lineageId` + `version` so the admin can see how
//     many orgs are on pro@v1 vs pro@v2 — tells them when they can retire
//     v1 safely (Phase 7 payoff).
//   - `overrideCount` is its own field: orgs with active `subscription.overrides`
//     effectively belong to neither the base tier nor a custom tier, so
//     bucketing them in `tierMix` would skew the picture.
//   - `nearLimitOrgs` covers `maxEvents` + `maxMembers` only. Per-event
//     `maxParticipantsPerEvent` would require a scan of every event's
//     registeredCount; skipped until there's a `usage` subcollection.

export interface PlanAnalyticsTier {
  /** Number of orgs on this tier (excluding those with active overrides). */
  count: number;
  /** Version→count map so the admin sees how many are on v1 vs v2 etc. */
  byVersion: Record<number, number>;
}

export interface PlanAnalyticsMoney {
  /** Sum across all tiers, in XOF. */
  total: number;
  /** Plan-key → amount in XOF. */
  byTier: Record<string, number>;
}

export interface PlanAnalyticsNearLimit {
  orgId: string;
  orgName: string;
  tier: string;
  resource: "events" | "members";
  current: number;
  limit: number;
  /** 0-100 integer. */
  pct: number;
}

export interface PlanAnalyticsTrialEnding {
  orgId: string;
  orgName: string;
  tier: string;
  /** ISO 8601. */
  trialEndAt: string;
}

export interface PlanAnalytics {
  /**
   * ISO timestamp this snapshot was computed at. The UI shows "mise à
   * jour à HH:MM" so operators know freshness.
   */
  computedAt: string;
  /** Monthly recurring revenue. Annual subs normalised as priceXof/12. */
  mrr: PlanAnalyticsMoney;
  /** Pipeline MRR — what trialing subs would contribute after conversion. */
  trialingMRR: PlanAnalyticsMoney;
  /** Raw cash recognised this period (annual billed at full year up-front). */
  bookings: PlanAnalyticsMoney;
  /** Active (non-trialing, non-cancelled) orgs grouped by tier + version. */
  tierMix: Record<string, PlanAnalyticsTier>;
  /** Split of active subs by billing cadence. */
  annualVsMonthly: { monthly: number; annual: number };
  /** Number of orgs with an active (non-expired) subscription.overrides. */
  overrideCount: number;
  /** Trials ending in the next 7 days, ordered by `trialEndAt` asc. */
  trialsEndingSoon: PlanAnalyticsTrialEnding[];
  /** Orgs at ≥80% of their effective event or member limit, desc by pct. */
  nearLimitOrgs: PlanAnalyticsNearLimit[];
}
