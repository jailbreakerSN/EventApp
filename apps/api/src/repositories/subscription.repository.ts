import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";
import { type Subscription } from "@teranga/shared-types";

export class SubscriptionRepository extends BaseRepository<Subscription> {
  constructor() {
    super(COLLECTIONS.SUBSCRIPTIONS, "Subscription");
  }

  async findByOrganization(organizationId: string): Promise<Subscription | null> {
    return this.findOne([{ field: "organizationId", op: "==", value: organizationId }]);
  }
}

export const subscriptionRepository = new SubscriptionRepository();
