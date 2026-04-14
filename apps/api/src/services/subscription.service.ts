import {
  type Organization,
  type OrganizationPlan,
  type Subscription,
  type SubscriptionOverrides,
  type PlanUsage,
  type UpgradePlanDto,
  PLAN_LIMITS,
  PLAN_DISPLAY,
  PLAN_LIMIT_UNLIMITED,
} from "@teranga/shared-types";
import { subscriptionRepository } from "@/repositories/subscription.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { planRepository } from "@/repositories/plan.repository";
import { eventRepository } from "@/repositories/event.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ValidationError, PlanLimitError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { db, COLLECTIONS } from "@/config/firebase";
import { resolveEffective, toStoredSnapshot, type EffectivePlan } from "./effective-plan";

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
   * Resolve the effective plan snapshot for an organization based on its
   * current plan (via the seeded catalog) and any subscription overrides.
   * Used by denormalization writes on upgrade/downgrade and by the backfill
   * script.
   *
   * Returns null if the catalog lookup fails (e.g. plan key not yet seeded).
   * Callers should tolerate null during the Phase 2 migration — enforcement
   * still falls back to the hardcoded PLAN_LIMITS.
   */
  async resolveEffectiveForOrg(
    planKey: OrganizationPlan | string,
    overrides?: SubscriptionOverrides,
    now: Date = new Date(),
  ): Promise<EffectivePlan | null> {
    const plan = await planRepository.findByKey(planKey);
    if (!plan) return null;
    return resolveEffective(plan, overrides, now);
  }

  /**
   * Compute current plan usage for an organization.
   * Queries event count and member count on demand (no counters collection).
   */
  async getUsage(orgId: string, user: AuthUser): Promise<PlanUsage> {
    this.requirePermission(user, "organization:read");
    this.requireOrganizationAccess(user, orgId);

    const org = await organizationRepository.findByIdOrThrow(orgId);
    const activeEvents = await eventRepository.countActiveByOrganization(orgId);
    const memberCount = org.memberIds?.length ?? 0;

    // Prefer the denormalized effective snapshot; fall back to PLAN_LIMITS when
    // the org predates the Phase 2 backfill.
    const effectiveLimitsStored = org.effectiveLimits;
    const effectiveFeaturesSnap = org.effectiveFeatures;
    const fallback = PLAN_LIMITS[org.plan];

    const maxEvents = effectiveLimitsStored
      ? effectiveLimitsStored.maxEvents === PLAN_LIMIT_UNLIMITED
        ? Infinity
        : effectiveLimitsStored.maxEvents
      : fallback.maxEvents;
    const maxMembers = effectiveLimitsStored
      ? effectiveLimitsStored.maxMembers === PLAN_LIMIT_UNLIMITED
        ? Infinity
        : effectiveLimitsStored.maxMembers
      : fallback.maxMembers;

    return {
      plan: org.plan,
      events: { current: activeEvents, limit: maxEvents },
      members: { current: memberCount, limit: maxMembers },
      features: { ...(effectiveFeaturesSnap ?? fallback.features) },
    };
  }

  /**
   * Upgrade an organization's plan.
   * For MVP: instant upgrade without payment processing.
   */
  async upgrade(orgId: string, dto: UpgradePlanDto, user: AuthUser): Promise<Subscription> {
    this.requirePermission(user, "organization:manage_billing");
    this.requireOrganizationAccess(user, orgId);

    const targetPlan = dto.plan;
    const now = new Date().toISOString();
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    const priceXof = PLAN_DISPLAY[targetPlan].priceXof;

    // Resolve effective snapshot for the target plan from the catalog. Done
    // outside the transaction — the plans collection is slow-moving and not
    // part of the atomicity boundary. Null return is tolerated during the
    // Phase 2 migration window (pre-seed) so upgrades never hard-fail on a
    // missing catalog entry.
    const existingSubscription = await subscriptionRepository.findByOrganization(orgId);
    const effective = await this.resolveEffectiveForOrg(
      targetPlan,
      existingSubscription?.overrides,
    );

    // Transactional: read org plan + validate + update + denormalize atomically
    const previousPlan = await db.runTransaction(async (tx) => {
      const orgRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId);
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) throw new ValidationError("Organisation introuvable");

      const orgData = orgSnap.data() as Organization;
      const validTargets = UPGRADE_PATHS[orgData.plan] ?? [];
      if (!validTargets.includes(targetPlan)) {
        throw new ValidationError(
          `Impossible de passer du plan ${orgData.plan} au plan ${targetPlan}`,
        );
      }

      const update: Record<string, unknown> = { plan: targetPlan };
      if (effective) {
        const stored = toStoredSnapshot(effective);
        update.effectiveLimits = stored.limits;
        update.effectiveFeatures = stored.features;
        update.effectivePlanKey = stored.planKey;
        update.effectiveComputedAt = stored.computedAt;
      }
      tx.update(orgRef, update);
      return orgData.plan;
    });

    // Subscription doc update (outside transaction — not critical for atomicity)
    let subscription: Subscription;
    if (existingSubscription) {
      await subscriptionRepository.update(existingSubscription.id, {
        plan: targetPlan,
        planId: effective?.planId,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd.toISOString(),
        priceXof,
        cancelledAt: null,
        updatedAt: now,
      } as Partial<Subscription>);
      subscription = await subscriptionRepository.findByIdOrThrow(existingSubscription.id);
    } else {
      subscription = await subscriptionRepository.create({
        organizationId: orgId,
        plan: targetPlan,
        planId: effective?.planId,
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
      previousPlan,
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

    const now = new Date().toISOString();

    // Resolve target plan snapshot from the catalog (overrides cleared on
    // downgrade — a downgrade always resets to the base plan). Fall back to
    // the hardcoded PLAN_LIMITS when the catalog lookup fails.
    const effective = await this.resolveEffectiveForOrg(targetPlan, undefined);
    const targetMaxMembers = effective
      ? effective.limits.maxMembers
      : PLAN_LIMITS[targetPlan].maxMembers;
    const targetMaxEvents = effective
      ? effective.limits.maxEvents
      : PLAN_LIMITS[targetPlan].maxEvents;

    // Transactional: read org + validate path + check usage + update + denormalize atomically
    const previousPlan = await db.runTransaction(async (tx) => {
      const orgRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId);
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) throw new ValidationError("Organisation introuvable");

      const orgData = orgSnap.data() as Organization;

      // Validate downgrade path
      const validTargets = DOWNGRADE_PATHS[orgData.plan] ?? [];
      if (!validTargets.includes(targetPlan)) {
        throw new ValidationError(
          `Impossible de passer du plan ${orgData.plan} au plan ${targetPlan}`,
        );
      }

      // Check usage fits target limits (member count is on the org doc — read atomically)
      const memberCount = orgData.memberIds?.length ?? 0;
      const violations: string[] = [];

      if (isFinite(targetMaxMembers) && memberCount > targetMaxMembers) {
        violations.push(`${memberCount} membres (max ${targetMaxMembers} sur ${targetPlan})`);
      }

      if (violations.length > 0) {
        throw new PlanLimitError(
          `Utilisation actuelle dépasse les limites du plan ${targetPlan}: ${violations.join(", ")}`,
        );
      }

      const update: Record<string, unknown> = { plan: targetPlan };
      if (effective) {
        const stored = toStoredSnapshot(effective);
        update.effectiveLimits = stored.limits;
        update.effectiveFeatures = stored.features;
        update.effectivePlanKey = stored.planKey;
        update.effectiveComputedAt = stored.computedAt;
      }
      tx.update(orgRef, update);
      return orgData.plan;
    });

    // Check event count outside transaction (not modifiable in this operation)
    const activeEvents = await eventRepository.countActiveByOrganization(orgId);
    if (isFinite(targetMaxEvents) && activeEvents > targetMaxEvents) {
      // Rollback plan change — usage exceeded
      await organizationRepository.update(orgId, { plan: previousPlan } as Partial<Organization>);
      throw new PlanLimitError(
        `${activeEvents} événements actifs (max ${targetMaxEvents} sur ${targetPlan})`,
      );
    }

    // Update subscription doc
    const existing = await subscriptionRepository.findByOrganization(orgId);
    if (existing) {
      if (targetPlan === "free") {
        await subscriptionRepository.update(existing.id, {
          status: "cancelled",
          plan: targetPlan,
          planId: effective?.planId,
          cancelledAt: now,
          updatedAt: now,
        } as Partial<Subscription>);
      } else {
        await subscriptionRepository.update(existing.id, {
          plan: targetPlan,
          planId: effective?.planId,
          priceXof: PLAN_DISPLAY[targetPlan].priceXof,
          updatedAt: now,
        } as Partial<Subscription>);
      }
    }

    eventBus.emit("subscription.downgraded", {
      organizationId: orgId,
      previousPlan,
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
