import { eventBus } from "../event-bus";
import { subscriptionService } from "@/services/subscription.service";
import { subscriptionRepository } from "@/repositories/subscription.repository";
import { applyEffectivePlan } from "@/repositories/transaction.helper";
import { db } from "@/config/firebase";

// ─── Effective-Plan Listener ────────────────────────────────────────────────
//
// Phase 2 safety net. The upgrade/downgrade service paths already refresh
// org.effectiveLimits transactionally, but this listener is the catch-all for
// mutations that change a subscription through other channels (direct repo
// writes in future admin tooling, webhook-driven changes, scheduled override
// expiry, etc.).
//
// All work happens asynchronously via the event bus — listener errors are
// isolated by the bus and never propagate back to the HTTP caller.

export function registerEffectivePlanListeners(): void {
  const refresh = async (organizationId: string, planKey: string): Promise<void> => {
    const subscription = await subscriptionRepository.findByOrganization(organizationId);
    const effective = await subscriptionService.resolveEffectiveForOrg(
      planKey,
      subscription?.overrides,
    );
    if (!effective) return;

    await db.runTransaction(async (tx) => {
      applyEffectivePlan(tx, organizationId, effective);
    });
  };

  eventBus.on("subscription.upgraded", async (payload) => {
    await refresh(payload.organizationId, payload.newPlan);
  });

  eventBus.on("subscription.downgraded", async (payload) => {
    await refresh(payload.organizationId, payload.newPlan);
  });
}
