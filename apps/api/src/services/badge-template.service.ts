import {
  type BadgeTemplate,
  type BadgeTemplateQuery,
  type CreateBadgeTemplateDto,
  type UpdateBadgeTemplateDto,
  normalizeFr,
} from "@teranga/shared-types";
import { badgeTemplateRepository } from "@/repositories/badge-template.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { type PaginatedResult } from "@/repositories/base.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";

export class BadgeTemplateService extends BaseService {
  async create(dto: CreateBadgeTemplateDto, user: AuthUser): Promise<BadgeTemplate> {
    this.requirePermission(user, "badge:generate");

    // Verify organization exists and user belongs to it
    const org = await organizationRepository.findByIdOrThrow(dto.organizationId);
    this.requireOrganizationAccess(user, dto.organizationId);

    // Gate custom badge templates behind `customBadges` (starter+).
    // The default badge template bundled with the platform remains free.
    this.requirePlanFeature(org, "customBadges");

    return badgeTemplateRepository.create(
      dto as Omit<BadgeTemplate, "id" | "createdAt" | "updatedAt">,
    );
  }

  async getById(templateId: string, user: AuthUser): Promise<BadgeTemplate> {
    this.requirePermission(user, "badge:generate");

    const template = await badgeTemplateRepository.findByIdOrThrow(templateId);
    this.requireOrganizationAccess(user, template.organizationId);

    return template;
  }

  /**
   * Doctrine-compliant template listing.
   *
   * Filters happen in two layers:
   *   1. Firestore (server-side): `organizationId` equality and the
   *      `isDefault` boolean filter when supplied. The repository sorts
   *      by `orderBy`/`orderDir` via the indexed composite.
   *   2. In-memory (server-side, post-Firestore): accent-folded substring
   *      match on `template.name`. Templates are bounded per org (typical
   *      <50, plan-cap at <2000 even for enterprise), so an in-memory
   *      filter is cheaper than maintaining a denormalised
   *      `nameNormalized` field + composite index per sort axis. The
   *      filter runs BEFORE pagination so `meta.total` is honest — no
   *      "page 2 silently misses results that didn't match q on page 1"
   *      regression of the kind the doctrine forbids.
   */
  async listByOrganization(
    query: BadgeTemplateQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<BadgeTemplate>> {
    this.requirePermission(user, "badge:generate");
    this.requireOrganizationAccess(user, query.organizationId);

    // Pull the full org template set from Firestore (capped at 200 by
    // the repository as a safety net — well above the practical max
    // even for enterprise tier). Doing q + pagination in-memory keeps
    // the contract honest for small datasets without forcing a
    // schema migration.
    const all = await badgeTemplateRepository.findByOrganization(query.organizationId, {
      isDefault: query.isDefault,
      orderBy: query.orderBy,
      orderDir: query.orderDir,
    });

    let filtered = all;
    if (query.q && query.q.trim().length > 0) {
      const needle = normalizeFr(query.q.trim());
      filtered = all.filter((t) => normalizeFr(t.name).includes(needle));
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    const start = (query.page - 1) * query.limit;
    const data = filtered.slice(start, start + query.limit);

    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  async update(templateId: string, dto: UpdateBadgeTemplateDto, user: AuthUser): Promise<void> {
    this.requirePermission(user, "badge:generate");

    const template = await badgeTemplateRepository.findByIdOrThrow(templateId);
    this.requireOrganizationAccess(user, template.organizationId);

    // Re-check `customBadges`: an org that downgraded off starter should
    // not be able to edit a template that survived the downgrade.
    const org = await organizationRepository.findByIdOrThrow(template.organizationId);
    this.requirePlanFeature(org, "customBadges");

    await badgeTemplateRepository.update(templateId, dto as Partial<BadgeTemplate>);
  }

  async remove(templateId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "badge:generate");

    const template = await badgeTemplateRepository.findByIdOrThrow(templateId);
    this.requireOrganizationAccess(user, template.organizationId);

    const org = await organizationRepository.findByIdOrThrow(template.organizationId);
    this.requirePlanFeature(org, "customBadges");

    await badgeTemplateRepository.softDelete(templateId);
  }
}

export const badgeTemplateService = new BadgeTemplateService();
