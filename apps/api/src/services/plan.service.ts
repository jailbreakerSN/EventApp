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
 */
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

  async update(planId: string, dto: UpdatePlanDto, user: AuthUser): Promise<Plan> {
    this.requirePermission(user, "plan:manage");

    const existing = await planRepository.findByIdOrThrow(planId);

    // System plans: narrow the updatable fields (no isArchived).
    if (existing.isSystem && dto.isArchived === true) {
      throw new ForbiddenError("Les plans système ne peuvent pas être archivés");
    }

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      return existing;
    }

    await planRepository.update(planId, patch as Partial<Plan>);
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

  async archive(planId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "plan:manage");

    const existing = await planRepository.findByIdOrThrow(planId);
    if (existing.isSystem) {
      throw new ForbiddenError("Les plans système ne peuvent pas être supprimés");
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
