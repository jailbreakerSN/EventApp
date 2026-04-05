import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "./base.repository";
import { type BadgeTemplate } from "@teranga/shared-types";

export class BadgeTemplateRepository extends BaseRepository<BadgeTemplate> {
  constructor() {
    super(COLLECTIONS.BADGE_TEMPLATES, "BadgeTemplate");
  }

  async findByOrganization(
    organizationId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<BadgeTemplate>> {
    return this.findMany(
      [{ field: "organizationId", op: "==", value: organizationId }],
      pagination ?? { page: 1, limit: 50, orderBy: "createdAt", orderDir: "desc" },
    );
  }

  async findDefaultForOrganization(organizationId: string): Promise<BadgeTemplate | null> {
    return this.findOne([
      { field: "organizationId", op: "==", value: organizationId },
      { field: "isDefault", op: "==", value: true },
    ]);
  }
}

export const badgeTemplateRepository = new BadgeTemplateRepository();
