import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";
import { type Organization } from "@teranga/shared-types";

export class OrganizationRepository extends BaseRepository<Organization> {
  constructor() {
    super(COLLECTIONS.ORGANIZATIONS, "Organization");
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return this.findOne([{ field: "slug", op: "==", value: slug }]);
  }

  async findByOwner(ownerId: string): Promise<Organization | null> {
    return this.findOne([{ field: "ownerId", op: "==", value: ownerId }]);
  }

  async addMember(orgId: string, userId: string): Promise<void> {
    const org = await this.findByIdOrThrow(orgId);
    const members: string[] = org.memberIds ?? [];
    if (members.includes(userId)) return;

    await this.update(orgId, {
      memberIds: [...members, userId],
    } as Partial<Organization>);
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    const org = await this.findByIdOrThrow(orgId);
    await this.update(orgId, {
      memberIds: (org.memberIds ?? []).filter((id) => id !== userId),
    } as Partial<Organization>);
  }
}

export const organizationRepository = new OrganizationRepository();
