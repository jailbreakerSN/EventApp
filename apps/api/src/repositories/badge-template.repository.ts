import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";
import { type BadgeTemplate } from "@teranga/shared-types";

/**
 * Filters supported by the doctrine-compliant `findByOrganization`
 * variant. Substring search on `name` is NOT pushed down to Firestore —
 * the service applies it in-memory (see badge-template.service.ts) so
 * the dataset doesn't have to carry a `nameNormalized` field and a
 * composite index per (orderBy × searchKeywords[]) variant.
 */
type FindByOrganizationFilters = {
  isDefault?: boolean;
  orderBy?: "name" | "createdAt" | "updatedAt";
  orderDir?: "asc" | "desc";
};

/**
 * Hard cap on the unfiltered fetch. Even enterprise-tier orgs cap at
 * dozens of badge templates in practice; 200 is a defensive safety net
 * so a Firestore misconfiguration doesn't pull tens of thousands of
 * docs into memory. If a real org ever crosses 200, the service will
 * silently truncate — switch to indexed search-keywords + cursor
 * pagination at that point. Kept as a constant so the service's
 * `meta.total` honesty contract is auditable.
 */
const ORG_TEMPLATE_HARD_CAP = 200;

export class BadgeTemplateRepository extends BaseRepository<BadgeTemplate> {
  constructor() {
    super(COLLECTIONS.BADGE_TEMPLATES, "BadgeTemplate");
  }

  /**
   * Doctrine-aware fetch. Returns the FULL list (up to ORG_TEMPLATE_HARD_CAP)
   * rather than a single page — the service composes q + pagination on top.
   * Sort is always pushed to Firestore so the index auditor sees the real
   * shape; the orderBy literal is the doctrine default ("name") and the
   * Zod enum on BadgeTemplateQuerySchema declares all reachable values
   * for index expansion.
   */
  async findByOrganization(
    organizationId: string,
    filters: FindByOrganizationFilters = {},
  ): Promise<BadgeTemplate[]> {
    const wheres: Array<{ field: string; op: "=="; value: unknown }> = [
      { field: "organizationId", op: "==", value: organizationId },
    ];
    if (filters.isDefault !== undefined) {
      wheres.push({ field: "isDefault", op: "==", value: filters.isDefault });
    }
    const result = await this.findMany(wheres, {
      page: 1,
      limit: ORG_TEMPLATE_HARD_CAP,
      orderBy: filters.orderBy ?? "name",
      orderDir: filters.orderDir ?? "asc",
    });
    return result.data;
  }

  async findDefaultForOrganization(organizationId: string): Promise<BadgeTemplate | null> {
    return this.findOne([
      { field: "organizationId", op: "==", value: organizationId },
      { field: "isDefault", op: "==", value: true },
    ]);
  }
}

export const badgeTemplateRepository = new BadgeTemplateRepository();
