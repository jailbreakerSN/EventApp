import {
  type BadgeTemplate,
  type CreateBadgeTemplateDto,
  type UpdateBadgeTemplateDto,
} from "@teranga/shared-types";
import { badgeTemplateRepository } from "@/repositories/badge-template.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { type PaginationParams, type PaginatedResult } from "@/repositories/base.repository";
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

  async listByOrganization(
    organizationId: string,
    user: AuthUser,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<BadgeTemplate>> {
    this.requirePermission(user, "badge:generate");
    this.requireOrganizationAccess(user, organizationId);

    return badgeTemplateRepository.findByOrganization(organizationId, pagination);
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

    await badgeTemplateRepository.softDelete(templateId);
  }
}

export const badgeTemplateService = new BadgeTemplateService();
