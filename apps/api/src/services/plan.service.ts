import crypto from "node:crypto";
import {
  type Plan,
  type CreatePlanDto,
  type UpdatePlanDto,
  type EntitlementMap,
  type PreviewChangeResponse,
  type PreviewAffectedOrg,
  PLAN_LIMIT_UNLIMITED,
} from "@teranga/shared-types";
import { planRepository } from "@/repositories/plan.repository";
import { db, COLLECTIONS } from "@/config/firebase";
import { subscriptionRepository } from "@/repositories/subscription.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { eventRepository } from "@/repositories/event.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ConflictError, ForbiddenError, NotFoundError } from "@/errors/app-error";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import { BaseService } from "./base.service";
import { resolveEffective } from "./effective-plan";

// French labels for feature keys — kept in sync with the client-side
// FEATURE_LABELS map (apps/web-backoffice/src/components/plans/PlanForm.tsx).
// Used by the preview-change violation strings so the UI banner doesn't
// leak raw camelCase keys like "smsNotifications" to operators.
const FEATURE_LABELS_FR: Record<string, string> = {
  qrScanning: "Scan QR",
  paidTickets: "Billets payants",
  customBadges: "Badges personnalisés",
  csvExport: "Export CSV",
  smsNotifications: "Notifications SMS",
  advancedAnalytics: "Analytics avancées",
  speakerPortal: "Portail intervenants",
  sponsorPortal: "Portail sponsors",
  apiAccess: "Accès API",
  whiteLabel: "Marque blanche",
  promoCodes: "Codes promo",
};

/**
 * Plan catalog service. Superadmins manage the catalog; everyone else can
 * only read the public catalog.
 *
 * Design notes
 * ────────────
 * - System plans (`isSystem: true`) are the four seeded tiers (free, starter,
 *   pro, enterprise). They cannot be deleted/archived and their `key` cannot
 *   be renamed, because downstream code (and the OrganizationPlan enum) relies
 *   on those keys. Limits, price, features and display info remain editable.
 * - Archiving (soft delete) is the only way to remove a custom plan — existing
 *   subscriptions referencing an archived plan are grandfathered.
 * - All mutations require `plan:manage`. Reads of the public catalog only
 *   require authentication.
 *
 * Versioning (Phase 7) — the "editing a plan never silently tightens existing
 * customers" contract:
 *
 * - Every plan carries a `lineageId` (shared across versions) and a `version`
 *   counter. `isLatest: true` marks the live row the catalog surfaces.
 * - `create()` starts a new lineage at v1.
 * - `update()` NEVER mutates prices/limits/features in place. It produces a
 *   NEW doc with the same `lineageId`, incremented `version`, `isLatest: true`,
 *   and flips the previous latest to `isLatest: false`. Existing subscriptions
 *   keep pointing at their original version — grandfathered automatically.
 * - `archive()` tombstones the latest version only; historical versions stay
 *   readable so grandfathered subscriptions keep resolving.
 *
 * Exceptions: pure-display fields (`sortOrder`, `isPublic`) get an in-place
 * patch on the LATEST doc. They have no effect on billing / grandfathering,
 * so minting a new version for each sort nudge would be silly.
 */

// Fields whose change must mint a new version (billing-material or
// capacity-material). Anything not in this set is patched in place on the
// latest doc.
const VERSION_MATERIAL_KEYS: ReadonlySet<keyof UpdatePlanDto> = new Set([
  "name",
  "description",
  "pricingModel",
  "priceXof",
  "limits",
  "features",
  // A change to `trialDays` affects the commercial terms a new customer
  // signs up under; existing trialing customers stay on their version so
  // their 14-day promise isn't silently extended or curtailed.
  "trialDays",
  // Annual pricing is a first-class billing term (Phase 7+ item #3). Tuning
  // it must mint a new version so annual subscribers keep the rate they
  // committed to — no silent mid-year price bumps on their renewal.
  "annualPriceXof",
  // Phase 7+ item #2 — entitlements are more version-material than
  // features / limits, not less: flipping `feature.paidTickets` via
  // entitlements is exactly the same commercial change as flipping it
  // via the legacy features map. Mint a new version so existing
  // subscribers retain their committed capability set. Review
  // blocker B4.
  "entitlements",
]);

function freshLineageId(): string {
  // Not prefixed with the plan key — the key can be renamed or reused across
  // lineages for custom plans, but the lineage identity stays stable.
  return `lin-${crypto.randomBytes(9).toString("hex")}`;
}

export class PlanService extends BaseService {
  async getPublicCatalog(): Promise<Plan[]> {
    return planRepository.listCatalog({ includeArchived: false, includePrivate: false });
  }

  async getByKey(key: string): Promise<Plan> {
    const plan = await planRepository.findByKey(key);
    if (!plan || plan.isArchived) {
      throw new NotFoundError("Plan", key);
    }
    return plan;
  }

  async listAll(user: AuthUser, options: { includeArchived?: boolean } = {}): Promise<Plan[]> {
    this.requirePermission(user, "plan:manage");
    return planRepository.listCatalog({
      includeArchived: options.includeArchived ?? true,
      includePrivate: true,
    });
  }

  async getById(planId: string, user: AuthUser): Promise<Plan> {
    this.requirePermission(user, "plan:manage");
    return planRepository.findByIdOrThrow(planId);
  }

  /**
   * Return every version of a plan lineage, newest first. Superadmin-only —
   * used by the (forthcoming) version-history UI and by audits that need to
   * know which pricing a given org was billed under.
   */
  async listLineage(key: string, user: AuthUser): Promise<Plan[]> {
    this.requirePermission(user, "plan:manage");
    const latest = await planRepository.findByKey(key);
    if (!latest) throw new NotFoundError("Plan", key);
    return planRepository.findLineage(latest.lineageId);
  }

  async create(dto: CreatePlanDto, user: AuthUser): Promise<Plan> {
    this.requirePermission(user, "plan:manage");

    const existing = await planRepository.findByKey(dto.key);
    if (existing) {
      throw new ConflictError(`Un plan avec la clé « ${dto.key} » existe déjà`);
    }

    const plan = await planRepository.create({
      key: dto.key,
      name: dto.name,
      description: dto.description ?? null,
      priceXof: dto.priceXof,
      annualPriceXof: dto.annualPriceXof ?? null,
      currency: "XOF",
      limits: dto.limits,
      features: dto.features,
      isSystem: false,
      isPublic: dto.isPublic,
      isArchived: false,
      sortOrder: dto.sortOrder,
      trialDays: dto.trialDays ?? null,
      version: 1,
      lineageId: freshLineageId(),
      isLatest: true,
      previousVersionId: null,
      createdBy: user.uid,
    } as Omit<Plan, "id" | "createdAt" | "updatedAt">);

    eventBus.emit("plan.created", {
      planId: plan.id,
      key: plan.key,
      actorId: user.uid,
      requestId: getRequestContext()?.requestId ?? "system",
      timestamp: new Date().toISOString(),
    });

    return plan;
  }

  /**
   * Update a plan.
   *
   * Behaviour depends on which fields are being changed:
   *
   *  - **Version-material fields** (name / description / pricingModel /
   *    priceXof / limits / features): create a NEW version doc, mark the
   *    previous `isLatest: false`, preserve the lineage. Existing
   *    subscriptions stay pinned to the old version (grandfathered).
   *  - **Display-only fields** (sortOrder / isPublic): patch the current
   *    latest doc in place. No new version.
   *  - **Archival** (`isArchived: true`): patches the current latest doc;
   *    routed through `archive()` rather than a raw update.
   *
   * System plans (`isSystem: true`) can still be versioned — you still can't
   * archive them, but price / limit / feature edits legitimately mint a new
   * version so pro-v2 doesn't silently tighten pro-v1 customers.
   */
  async update(planId: string, dto: UpdatePlanDto, user: AuthUser): Promise<Plan> {
    this.requirePermission(user, "plan:manage");

    const existing = await planRepository.findByIdOrThrow(planId);

    // Guardrails.
    if (existing.isSystem && dto.isArchived === true) {
      throw new ForbiddenError("Les plans système ne peuvent pas être archivés");
    }
    if (existing.isLatest === false) {
      throw new ConflictError(
        "Impossible de modifier une version historique — éditez la version courante",
      );
    }

    // Split the DTO into version-material vs display-only / archival.
    const patch: Partial<Plan> = {};
    const versionPatch: Partial<Plan> = {};
    let hasVersionChange = false;
    let hasDisplayOnlyChange = false;
    for (const [key, value] of Object.entries(dto) as Array<
      [keyof UpdatePlanDto, UpdatePlanDto[keyof UpdatePlanDto]]
    >) {
      if (value === undefined) continue;
      if (VERSION_MATERIAL_KEYS.has(key)) {
        (versionPatch as Record<string, unknown>)[key] = value;
        hasVersionChange = true;
      } else {
        (patch as Record<string, unknown>)[key] = value;
        hasDisplayOnlyChange = true;
      }
    }
    if (!hasVersionChange && !hasDisplayOnlyChange) {
      return existing;
    }

    // ── Display-only fast path (no new version) ───────────────────────────
    if (!hasVersionChange) {
      await planRepository.update(planId, patch);
      const updated = await planRepository.findByIdOrThrow(planId);
      eventBus.emit("plan.updated", {
        planId,
        key: updated.key,
        actorId: user.uid,
        changes: Object.keys(patch),
        requestId: getRequestContext()?.requestId ?? "system",
        timestamp: new Date().toISOString(),
      });
      return updated;
    }

    // ── Version-material path: mint a new doc, flip old `isLatest` ────────
    // Merge version-material changes on top of the existing snapshot so the
    // new doc is fully self-describing (previous version remains untouched
    // and readable for grandfathered subscriptions).
    const mergedFeatures = versionPatch.features
      ? { ...existing.features, ...versionPatch.features }
      : existing.features;
    const mergedLimits = versionPatch.limits
      ? { ...existing.limits, ...versionPatch.limits }
      : existing.limits;

    // Version-material mint + old-latest flip atomically. Without a
    // transaction, a crash between the new doc's write and the old doc's
    // flip would leave the lineage with two `isLatest: true` rows (catalog
    // reader tolerates that but it's a catalog-hygiene bug), and a
    // concurrent update racing against us could double-version the same
    // edit. We also re-read the old doc inside the tx to guard against
    // another admin minting a version between our `findByIdOrThrow` above
    // and the commit — if `isLatest` has already flipped, abort.
    const now = new Date().toISOString();
    const newRef = db.collection(COLLECTIONS.PLANS).doc();
    const newVersionData: Plan = {
      id: newRef.id,
      key: existing.key,
      name: versionPatch.name ?? existing.name,
      description:
        versionPatch.description !== undefined ? versionPatch.description : existing.description,
      pricingModel: versionPatch.pricingModel ?? existing.pricingModel,
      priceXof: versionPatch.priceXof ?? existing.priceXof,
      annualPriceXof:
        "annualPriceXof" in versionPatch
          ? (versionPatch.annualPriceXof ?? null)
          : (existing.annualPriceXof ?? null),
      currency: existing.currency,
      limits: mergedLimits,
      features: mergedFeatures,
      // Phase 7+ item #2 — carry entitlements into the new version.
      // Resolve first, then conditionally SPREAD so the field is simply
      // omitted when the effective value is "no entitlements" (legacy
      // path). Firestore rejects explicit `undefined` values on
      // `tx.set()`, so the omit-when-absent pattern is required. Review
      // blocker B4.
      //
      // Semantics:
      //   - versionPatch.entitlements populated → new version has it.
      //   - versionPatch.entitlements === null → clear; omit on new doc.
      //   - versionPatch.entitlements not in patch → inherit from
      //     existing; omit when existing is null/undefined.
      ...(() => {
        const next: EntitlementMap | null | undefined =
          "entitlements" in versionPatch
            ? versionPatch.entitlements
            : existing.entitlements;
        return next ? { entitlements: next } : {};
      })(),
      isSystem: existing.isSystem,
      isPublic: "isPublic" in patch ? (patch.isPublic ?? existing.isPublic) : existing.isPublic,
      isArchived: false,
      sortOrder:
        "sortOrder" in patch ? (patch.sortOrder ?? existing.sortOrder) : existing.sortOrder,
      trialDays:
        "trialDays" in versionPatch
          ? (versionPatch.trialDays ?? null)
          : (existing.trialDays ?? null),
      version: (existing.version ?? 1) + 1,
      lineageId: existing.lineageId ?? `lin-${existing.id}-legacy`,
      isLatest: true,
      previousVersionId: existing.id,
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
    } as Plan;

    await db.runTransaction(async (tx) => {
      const oldRef = db.collection(COLLECTIONS.PLANS).doc(existing.id);
      const oldSnap = await tx.get(oldRef);
      if (!oldSnap.exists) throw new NotFoundError("Plan", existing.id);
      const oldData = oldSnap.data() as Plan;
      if (oldData.isLatest === false) {
        throw new ConflictError(
          "Une autre mise à jour a été appliquée entre-temps — rechargez la page",
        );
      }
      tx.set(newRef, newVersionData);
      tx.update(oldRef, { isLatest: false, updatedAt: now });
    });

    const newVersion = newVersionData;

    eventBus.emit("plan.updated", {
      planId: newVersion.id,
      key: newVersion.key,
      actorId: user.uid,
      changes: Object.keys(versionPatch),
      requestId: getRequestContext()?.requestId ?? "system",
      timestamp: new Date().toISOString(),
    });

    return newVersion;
  }

  async archive(planId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "plan:manage");

    const existing = await planRepository.findByIdOrThrow(planId);
    if (existing.isSystem) {
      throw new ForbiddenError("Les plans système ne peuvent pas être supprimés");
    }
    if (existing.isLatest === false) {
      throw new ConflictError(
        "Impossible d'archiver une version historique — archivez la version courante",
      );
    }

    if (existing.isArchived) return;

    await planRepository.update(planId, { isArchived: true } as Partial<Plan>);

    eventBus.emit("plan.archived", {
      planId,
      key: existing.key,
      actorId: user.uid,
      requestId: getRequestContext()?.requestId ?? "system",
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Dry-run / impact preview (Phase 7+ item #6).
   *
   * Given a proposed `UpdatePlanDto`, simulate the change and return the
   * list of organisations whose current usage would violate the new
   * limits (or who would lose a feature they are using). Does NOT
   * mutate the catalog — pair with `update()` once the superadmin
   * confirms.
   *
   * Algorithm:
   *  1. If the patch is display-only (sortOrder / isPublic), short-circuit
   *     with `willMintNewVersion: false` — the UI can skip the banner.
   *  2. Otherwise, scan every subscription in the plan's lineage
   *     (including older versions — the admin wants to know about
   *     grandfathered cohorts they might later migrate).
   *  3. For each subscription, resolve the HYPOTHETICAL effective plan
   *     by feeding the merged patched plan into `resolveEffective()` with
   *     the org's own overrides — so an override that masks a violation
   *     (e.g. override maxEvents: 50 on top of new cap 5) is honoured.
   *  4. Read the org's current usage (active events + member count) via
   *     the denormalised fields on the org doc when available, falling
   *     back to a repository count.
   *  5. Emit human-readable French violation strings, one per broken
   *     constraint. Empty array = org pinned but unaffected.
   *
   * Permissions: `plan:manage` (superadmin). No mutation → no audit
   * event emitted.
   */
  async previewChange(
    planId: string,
    dto: UpdatePlanDto,
    user: AuthUser,
  ): Promise<PreviewChangeResponse> {
    this.requirePermission(user, "plan:manage");

    const existing = await planRepository.findByIdOrThrow(planId);
    if (existing.isLatest === false) {
      throw new ConflictError(
        "Impossible de prévisualiser une modification d'une version historique",
      );
    }

    // Split the patch the same way `update()` does so we give callers a
    // single source of truth about which edits mint new versions.
    let hasVersionMaterialChange = false;
    for (const [key, value] of Object.entries(dto) as Array<
      [keyof UpdatePlanDto, UpdatePlanDto[keyof UpdatePlanDto]]
    >) {
      if (value === undefined) continue;
      if (VERSION_MATERIAL_KEYS.has(key)) {
        hasVersionMaterialChange = true;
        break;
      }
    }

    if (!hasVersionMaterialChange) {
      // Display-only edits don't affect any subscriber. Short-circuit so
      // the UI doesn't render a warning banner on a sort nudge.
      return {
        willMintNewVersion: false,
        totalScanned: 0,
        totalAffected: 0,
        affected: [],
      };
    }

    // Build the HYPOTHETICAL next version — the Plan shape that `update()`
    // would mint. We never persist this; it's only a merge of
    // existing + patch so `resolveEffective()` has something to read.
    const mergedFeatures = dto.features
      ? { ...existing.features, ...dto.features }
      : existing.features;
    const mergedLimits = dto.limits ? { ...existing.limits, ...dto.limits } : existing.limits;
    const hypothetical: Plan = {
      ...existing,
      pricingModel: dto.pricingModel ?? existing.pricingModel,
      priceXof: dto.priceXof ?? existing.priceXof,
      annualPriceXof:
        "annualPriceXof" in dto ? (dto.annualPriceXof ?? null) : (existing.annualPriceXof ?? null),
      limits: mergedLimits,
      features: mergedFeatures,
      trialDays: "trialDays" in dto ? (dto.trialDays ?? null) : (existing.trialDays ?? null),
    };

    // Scan the WHOLE lineage, not just this version. A superadmin editing
    // pro@v2 still wants to see the v1 grandfathers they'd affect if they
    // later migrated the cohort.
    const lineage = await planRepository.findLineage(existing.lineageId);
    const versionIds = lineage.map((p) => p.id);

    // Targeted query: fetch only subscriptions pinned to this lineage's
    // versions instead of scanning the whole subscriptions collection.
    // Firestore's `in` operator accepts up to 30 values — more than any
    // realistic version history for a single plan. (Chunk if we ever hit
    // that ceiling; for now 30 versions on a single lineage would be a
    // catalog-hygiene problem worth fixing separately.)
    const allSubs = versionIds.length
      ? await subscriptionRepository.findMany([{ field: "planId", op: "in", value: versionIds }], {
          page: 1,
          limit: 1_000,
          orderBy: "createdAt",
          orderDir: "desc",
        })
      : { data: [], meta: { page: 1, limit: 0, total: 0, totalPages: 0 } };
    const subs = allSubs.data;

    const now = new Date();
    const affected: PreviewAffectedOrg[] = [];

    for (const sub of subs) {
      const org = await organizationRepository.findById(sub.organizationId);
      if (!org) continue;

      // Resolve the hypothetical effective plan honouring the sub's own
      // overrides (so an org with `overrides.limits.maxEvents: 50` isn't
      // flagged when the new base cap drops to 5).
      const effective = resolveEffective(hypothetical, sub.overrides, now);

      // Current usage: read denormalised fields first; fall back to live
      // counts only when we have to. Keeps the preview cheap at scale.
      const activeEvents = await eventRepository.countActiveByOrganization(org.id);
      const memberCount = org.memberIds?.length ?? 0;

      const violations: string[] = [];

      // maxEvents
      if (
        Number.isFinite(effective.limits.maxEvents) &&
        activeEvents > effective.limits.maxEvents
      ) {
        violations.push(
          `${activeEvents} événements actifs (nouvelle limite : ${effective.limits.maxEvents})`,
        );
      }
      // maxMembers
      if (
        Number.isFinite(effective.limits.maxMembers) &&
        memberCount > effective.limits.maxMembers
      ) {
        violations.push(
          `${memberCount} membres (nouvelle limite : ${effective.limits.maxMembers})`,
        );
      }
      // Feature removals — only flag features the org's CURRENT effective
      // fields indicate they were using. Without usage telemetry per
      // feature we approximate "using" as "feature is on in their current
      // effective snapshot".
      const currentFeatures = org.effectiveFeatures ?? existing.features;
      for (const [feat, nextValue] of Object.entries(effective.features)) {
        if (!nextValue && currentFeatures[feat as keyof typeof currentFeatures]) {
          // Map the camelCase key to its French label so the banner stays
          // francophone-first and doesn't leak internal identifiers.
          const label = FEATURE_LABELS_FR[feat] ?? feat;
          violations.push(`Fonctionnalité retirée : ${label}`);
        }
      }

      // maxParticipantsPerEvent is NOT previewed (would require a per-event
      // scan). Explicit non-goal — users learn at registration time.
      void PLAN_LIMIT_UNLIMITED;

      const pinnedVersion = lineage.find((p) => p.id === sub.planId);
      affected.push({
        orgId: org.id,
        name: org.name,
        currentVersion: pinnedVersion?.version ?? 1,
        isTrialing: sub.status === "trialing",
        billingCycle: sub.billingCycle ?? null,
        violations,
      });
    }

    // Sort so orgs with the most violations surface first — superadmin's
    // eyes go to the top.
    affected.sort((a, b) => b.violations.length - a.violations.length);

    return {
      willMintNewVersion: true,
      totalScanned: subs.length,
      totalAffected: affected.filter((a) => a.violations.length > 0).length,
      affected,
    };
  }
}

export const planService = new PlanService();
