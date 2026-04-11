import {
  type Organization,
  type OrganizationPlan,
  type Subscription,
  type PlanUsage,
  type UpgradePlanDto,
  PLAN_LIMITS,
  PLAN_DISPLAY,
} from "@teranga/shared-types";
import { subscriptionRepository } from "@/repositories/subscription.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { eventRepository } from "@/repositories/event.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ValidationError, PlanLimitError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

// Valid upgrade paths: free -> starter/pro, starter -> pro
const UPGRADE_PATHS: Record<string, OrganizationPlan[]> = {
  free: ["starter", "pro", "enterprise"],
  starter: ["pro", "enterprise"],
  pro: ["enterprise"],
  enterprise: [],
};

const DOWNGRADE_PATHS: Record<string, OrganizationPlan[]> = {
  enterprise: ["pro", "starter", "free"],
  pro: ["starter", "free"],
  starter: ["free"],
  free: [],
};

export class SubscriptionService extends BaseService {
  /**
   * Get current subscription for an organization.
   * Returns null for free plan (no subscription doc needed).
   */
  async getSubscription(orgId: string, user: AuthUser): Promise<Subscription | null> {
    this.requirePermission(user, "organization:manage_billing");
    this.requireOrganizationAccess(user, orgId);

    return subscriptionRepository.findByOrganization(orgId);
  }

  /**
   * Compute current plan usage for an organization.
   * Queries event count and member count on demand (no counters collection).
   */
  async getUsage(orgId: string, user: AuthUser): Promise<PlanUsage> {
    this.requirePermission(user, "organization:read");
    this.requireOrganizationAccess(user, orgId);

    const org = await organizationRepository.findByIdOrThrow(orgId);
    const limits = PLAN_LIMITS[org.plan];
    const activeEvents = await eventRepository.countActiveByOrganization(orgId);
    const memberCount = org.memberIds?.length ?? 0;

    return {
      plan: org.plan,
      events: {
        current: activeEvents,
        limit: limits.maxEvents,
      },
      members: {
        current: memberCount,
        limit: limits.maxMembers,
      },
      features: { ...limits.features },
    };
  }

  /**
   * Upgrade an organization's plan.
   * For MVP: instant upgrade without payment processing.
   */
  async upgrade(orgId: string, dto: UpgradePlanDto, user: AuthUser): Promise<Subscription> {
    this.requirePermission(user, "organization:manage_billing");
    this.requireOrganizationAccess(user, orgId);

    const org = await organizationRepository.findByIdOrThrow(orgId);
    const targetPlan = dto.plan;

    // Validate upgrade path
    const validTargets = UPGRADE_PATHS[org.plan] ?? [];
    if (!validTargets.includes(targetPlan)) {
      throw new ValidationError(`Impossible de passer du plan ${org.plan} au plan ${targetPlan}`);
    }

    const now = new Date().toISOString();
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Update organization plan
    await organizationRepository.update(orgId, {
      plan: targetPlan,
    } as Partial<Organization>);

    // Create or update subscription doc
    const existing = await subscriptionRepository.findByOrganization(orgId);
    const priceXof = PLAN_DISPLAY[targetPlan].priceXof;

    let subscription: Subscription;
    if (existing) {
      await subscriptionRepository.update(existing.id, {
        plan: targetPlan,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd.toISOString(),
        priceXof,
        cancelledAt: null,
        updatedAt: now,
      } as Partial<Subscription>);
      subscription = await subscriptionRepository.findByIdOrThrow(existing.id);
    } else {
      subscription = await subscriptionRepository.create({
        organizationId: orgId,
        plan: targetPlan,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd.toISOString(),
        cancelledAt: null,
        paymentMethod: null,
        priceXof,
      } as Omit<Subscription, "id" | "createdAt" | "updatedAt">);
    }

    eventBus.emit("subscription.upgraded", {
      organizationId: orgId,
      previousPlan: org.plan,
      newPlan: targetPlan,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return subscription;
  }

  /**
   * Downgrade an organization's plan.
   * Validates that current usage fits within the target plan's limits.
   */
  async downgrade(orgId: string, targetPlan: OrganizationPlan, user: AuthUser): Promise<void> {
    this.requirePermission(user, "organization:manage_billing");
    this.requireOrganizationAccess(user, orgId);

    const org = await organizationRepository.findByIdOrThrow(orgId);

    // Validate downgrade path
    const validTargets = DOWNGRADE_PATHS[org.plan] ?? [];
    if (!validTargets.includes(targetPlan)) {
      throw new ValidationError(`Impossible de passer du plan ${org.plan} au plan ${targetPlan}`);
    }

    // Check that current usage fits within target plan limits
    const targetLimits = PLAN_LIMITS[targetPlan];
    const activeEvents = await eventRepository.countActiveByOrganization(orgId);
    const memberCount = org.memberIds?.length ?? 0;

    const violations: string[] = [];
    if (isFinite(targetLimits.maxEvents) && activeEvents > targetLimits.maxEvents) {
      violations.push(
        `${activeEvents} événements actifs (max ${targetLimits.maxEvents} sur ${targetPlan})`,
      );
    }
    if (isFinite(targetLimits.maxMembers) && memberCount > targetLimits.maxMembers) {
      violations.push(`${memberCount} membres (max ${targetLimits.maxMembers} sur ${targetPlan})`);
    }

    if (violations.length > 0) {
      throw new PlanLimitError(
        `Utilisation actuelle dépasse les limites du plan ${targetPlan}: ${violations.join(", ")}`,
      );
    }

    const now = new Date().toISOString();

    // Update organization plan
    await organizationRepository.update(orgId, {
      plan: targetPlan,
    } as Partial<Organization>);

    // Update subscription
    const existing = await subscriptionRepository.findByOrganization(orgId);
    if (existing) {
      if (targetPlan === "free") {
        await subscriptionRepository.update(existing.id, {
          status: "cancelled",
          plan: targetPlan,
          cancelledAt: now,
          updatedAt: now,
        } as Partial<Subscription>);
      } else {
        await subscriptionRepository.update(existing.id, {
          plan: targetPlan,
          priceXof: PLAN_DISPLAY[targetPlan].priceXof,
          updatedAt: now,
        } as Partial<Subscription>);
      }
    }

    eventBus.emit("subscription.downgraded", {
      organizationId: orgId,
      previousPlan: org.plan,
      newPlan: targetPlan,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });
  }

  /**
   * Cancel subscription — reverts to free plan.
   */
  async cancel(orgId: string, user: AuthUser): Promise<void> {
    return this.downgrade(orgId, "free", user);
  }
}

export const subscriptionService = new SubscriptionService();
