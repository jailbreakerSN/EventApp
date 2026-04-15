import crypto from "node:crypto";
import { type Plan, type CreatePlanDto, type UpdatePlanDto } from "@teranga/shared-types";
import { planRepository } from "@/repositories/plan.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ConflictError, ForbiddenError, NotFoundError } from "@/errors/app-error";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import { BaseService } from "./base.service";

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

    const newVersion = await planRepository.create({
      key: existing.key,
      name: versionPatch.name ?? existing.name,
      description:
        versionPatch.description !== undefined ? versionPatch.description : existing.description,
      pricingModel: versionPatch.pricingModel ?? existing.pricingModel,
      priceXof: versionPatch.priceXof ?? existing.priceXof,
      currency: existing.currency,
      limits: mergedLimits,
      features: mergedFeatures,
      isSystem: existing.isSystem,
      // Display-only changes (if bundled in the same call) land on the NEW
      // version — simpler than split-writing both old and new.
      isPublic: "isPublic" in patch ? (patch.isPublic ?? existing.isPublic) : existing.isPublic,
      isArchived: false,
      sortOrder:
        "sortOrder" in patch ? (patch.sortOrder ?? existing.sortOrder) : existing.sortOrder,
      trialDays:
        "trialDays" in versionPatch
          ? (versionPatch.trialDays ?? null)
          : (existing.trialDays ?? null),
      // Guard against pre-Phase-7 plans that were written before versioning
      // landed — they may lack `version` / `lineageId`. Treat missing metadata
      // as "v1 with a self-lineage".
      version: (existing.version ?? 1) + 1,
      lineageId: existing.lineageId ?? `lin-${existing.id}-legacy`,
      isLatest: true,
      previousVersionId: existing.id,
      createdBy: user.uid,
    } as Omit<Plan, "id" | "createdAt" | "updatedAt">);

    // Flip the previous latest flag. Done after the new doc exists so that
    // a concurrent reader never sees zero latest versions for this lineage
    // (they might briefly see two — the catalog reader tolerates that by
    // preferring the first match; Phase 7+ follow-up can tighten via a txn
    // once we have volume).
    await planRepository.update(existing.id, { isLatest: false } as Partial<Plan>);

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
}

export const planService = new PlanService();
