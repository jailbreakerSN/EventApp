import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";
import { type OrganizationInvite } from "@teranga/shared-types";

export class InviteRepository extends BaseRepository<OrganizationInvite> {
  constructor() {
    super(COLLECTIONS.INVITES, "Invite");
  }

  async findByToken(token: string): Promise<OrganizationInvite | null> {
    return this.findOne([{ field: "token", op: "==", value: token }]);
  }

  async findByEmailAndOrg(email: string, organizationId: string): Promise<OrganizationInvite | null> {
    return this.findOne([
      { field: "email", op: "==", value: email },
      { field: "organizationId", op: "==", value: organizationId },
      { field: "status", op: "==", value: "pending" },
    ]);
  }

  async findByOrganization(organizationId: string): Promise<OrganizationInvite[]> {
    const result = await this.findMany(
      [{ field: "organizationId", op: "==", value: organizationId }],
      { page: 1, limit: 100, orderBy: "createdAt", orderDir: "desc" },
    );
    return result.data;
  }
}

export const inviteRepository = new InviteRepository();
