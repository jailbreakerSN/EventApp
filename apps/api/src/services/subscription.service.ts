import {
  type Organization,
  type OrganizationPlan,
  type Subscription,
  type SubscriptionOverrides,
  type PlanUsage,
  type UpgradePlanDto,
  type ScheduledChange,
  type ScheduledChangeReason,
  type AssignPlanDto,
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
    const nowDate = new Date();
    const now = nowDate.toISOString();

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

    // ── Trial enrolment (Phase 7+ item #4) ─────────────────────────────────
    // A plan's catalog entry may carry `trialDays > 0`. A first-time upgrade
    // from a non-paying org (no prior subscription, or current subscription
    // on "free") starts a trial: status "trialing", priceXof suspended to 0,
    // currentPeriodEnd = now + trialDays, and a scheduledChange with
    // reason="trial_ended" queued so the daily rollover flips the sub to
    // "active" at trial end. Once a customer has ever paid (any status !=
    // "free"), trials no longer apply — matches the industry-standard
    // "once per customer" semantic without a separate history collection.
    const catalogPlan = effective ? await planRepository.findById(effective.planId) : null;
    const trialDays = catalogPlan?.trialDays ?? 0;
    const isFirstPaidUpgrade = !existingSubscription || existingSubscription.plan === "free";
    const startsWithTrial = trialDays > 0 && isFirstPaidUpgrade;

    // Trial: period ends at `now + trialDays`; monthly otherwise.
    const periodEnd = new Date(nowDate);
    if (startsWithTrial) {
      periodEnd.setDate(periodEnd.getDate() + trialDays);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }
    const periodEndIso = periodEnd.toISOString();

    const fullPriceXof = PLAN_DISPLAY[targetPlan].priceXof;
    // During a trial the customer is not charged — store priceXof as 0 so
    // billing summaries don't surface a mid-trial debit. After rollover
    // flips status → active, the rollover worker rewrites priceXof from
    // the catalog.
    const priceXof = startsWithTrial ? 0 : fullPriceXof;

    // Queue the end-of-trial flip as a scheduledChange — the daily rollover
    // worker already scans that collection by effectiveAt, so we reuse the
    // existing infra instead of adding a parallel trial-scanner. The
    // rollover handler recognizes reason="trial_ended" and flips status
    // without touching the plan (same target plan, just trialing → active).
    const scheduledChange: Subscription["scheduledChange"] = startsWithTrial
      ? {
          toPlan: targetPlan,
          toPlanId: effective?.planId,
          effectiveAt: periodEndIso,
          reason: "trial_ended",
          scheduledBy: user.uid,
          scheduledAt: now,
        }
      : null;

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

    // Subscription doc update (outside transaction — not critical for atomicity).
    // Upgrading wipes any previously-queued scheduled downgrade — the user
    // changed their mind and is strengthening their commitment. Trial enrolment
    // writes its own scheduledChange (reason="trial_ended"), which is why we
    // set it directly to `scheduledChange` rather than hardcoding null.
    const status: Subscription["status"] = startsWithTrial ? "trialing" : "active";
    let subscription: Subscription;
    if (existingSubscription) {
      await subscriptionRepository.update(existingSubscription.id, {
        plan: targetPlan,
        planId: effective?.planId,
        status,
        currentPeriodStart: now,
        currentPeriodEnd: periodEndIso,
        priceXof,
        cancelledAt: null,
        scheduledChange,
        updatedAt: now,
      } as Partial<Subscription>);
      subscription = await subscriptionRepository.findByIdOrThrow(existingSubscription.id);
    } else {
      subscription = await subscriptionRepository.create({
        organizationId: orgId,
        plan: targetPlan,
        planId: effective?.planId,
        status,
        currentPeriodStart: now,
        currentPeriodEnd: periodEndIso,
        cancelledAt: null,
        paymentMethod: null,
        priceXof,
        scheduledChange,
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
   *
   * Default: SCHEDULED at `currentPeriodEnd` — the user keeps their paid
   * rights until the end of the billing period they already paid for.
   * A daily Cloud Function rollover applies the flip at that boundary.
   *
   * `immediate: true` flips right now. Requires `subscription:override`
   * (admin emergency path). Used by the rollover job itself too, with the
   * rollover actor bypassing the permission check.
   *
   * Validates that current usage fits within the target plan's limits
   * (applies in both modes — you can't schedule a downgrade that would
   * leave the org in an invalid state even at period end, because member
   * count can't go down just because time passed).
   */
  async downgrade(
    orgId: string,
    targetPlan: OrganizationPlan,
    user: AuthUser,
    options: { immediate?: boolean; reason?: ScheduledChangeReason; note?: string } = {},
  ): Promise<{ scheduled: boolean; effectiveAt?: string }> {
    this.requirePermission(user, "organization:manage_billing");
    this.requireOrganizationAccess(user, orgId);

    if (options.immediate) {
      // Admin emergency path — requires the override permission in addition
      // to the standard billing permission the caller already passed.
      this.requirePermission(user, "subscription:override");
    }

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

    // ── SCHEDULED downgrade path (default) ──────────────────────────────────
    // If a paid period is still in force, queue the change instead of
    // flipping. The user keeps their paid rights; the rollover job flips
    // at currentPeriodEnd.
    if (!options.immediate) {
      const existingSub = await subscriptionRepository.findByOrganization(orgId);
      const currentPeriodEnd = existingSub?.currentPeriodEnd;
      const paidPeriodInForce =
        existingSub &&
        existingSub.status !== "cancelled" &&
        currentPeriodEnd &&
        new Date(currentPeriodEnd).getTime() > Date.now();

      if (paidPeriodInForce) {
        // Validate the downgrade path at SCHEDULE time so we don't let a
        // customer queue something that would be rejected at rollover.
        const org = await organizationRepository.findByIdOrThrow(orgId);
        const validTargets = DOWNGRADE_PATHS[org.plan] ?? [];
        if (!validTargets.includes(targetPlan)) {
          throw new ValidationError(
            `Impossible de passer du plan ${org.plan} au plan ${targetPlan}`,
          );
        }
        // Validate fit (member count checked at schedule time; event count
        // rechecked at rollover — events can grow before effectiveAt).
        const memberCount = org.memberIds?.length ?? 0;
        if (isFinite(targetMaxMembers) && memberCount > targetMaxMembers) {
          throw new PlanLimitError(
            `Utilisation actuelle dépasse les limites du plan ${targetPlan}: ${memberCount} membres (max ${targetMaxMembers})`,
          );
        }

        const scheduledChange: ScheduledChange = {
          toPlan: targetPlan,
          toPlanId: effective?.planId,
          effectiveAt: currentPeriodEnd,
          reason: options.reason ?? (targetPlan === "free" ? "cancel" : "downgrade"),
          scheduledBy: user.uid,
          scheduledAt: now,
          ...(options.note ? { note: options.note } : {}),
        };
        await subscriptionRepository.update(existingSub.id, {
          scheduledChange,
          updatedAt: now,
        } as Partial<Subscription>);

        eventBus.emit("subscription.change_scheduled", {
          organizationId: orgId,
          fromPlan: org.plan,
          toPlan: targetPlan,
          effectiveAt: currentPeriodEnd,
          reason: scheduledChange.reason,
          actorId: user.uid,
          requestId: getRequestId(),
          timestamp: now,
        });

        return { scheduled: true, effectiveAt: currentPeriodEnd };
      }
      // No paid period in force → fall through to the immediate path. This
      // covers: free orgs (no subscription), already-cancelled subs, and
      // subs whose currentPeriodEnd is already past. Either way the user
      // has no prepaid rights to honor.
    }

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

    // Update subscription doc. Any previously queued scheduledChange is
    // cleared — we've just applied a flip, so a pending one (possibly
    // stale) is no longer meaningful.
    const existing = await subscriptionRepository.findByOrganization(orgId);
    if (existing) {
      if (targetPlan === "free") {
        await subscriptionRepository.update(existing.id, {
          status: "cancelled",
          plan: targetPlan,
          planId: effective?.planId,
          cancelledAt: now,
          scheduledChange: null,
          updatedAt: now,
        } as Partial<Subscription>);
      } else {
        await subscriptionRepository.update(existing.id, {
          plan: targetPlan,
          planId: effective?.planId,
          priceXof: PLAN_DISPLAY[targetPlan].priceXof,
          scheduledChange: null,
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

    return { scheduled: false };
  }

  /**
   * Cancel subscription — schedules a downgrade to free at the end of the
   * current paid period (default) or flips immediately with `immediate: true`.
   */
  async cancel(
    orgId: string,
    user: AuthUser,
    options: { immediate?: boolean; reason?: string } = {},
  ): Promise<{ scheduled: boolean; effectiveAt?: string }> {
    return this.downgrade(orgId, "free", user, {
      immediate: options.immediate,
      reason: "cancel",
      note: options.reason,
    });
  }

  /**
   * Revert a previously-scheduled plan change. The user changed their mind
   * before the rollover ran; wipe the scheduledChange so the period rolls
   * over into the same plan (implicit renewal).
   *
   * No-op (returns without error) when there's no scheduled change to revert
   * — idempotent for UI "cancel schedule" actions.
   */
  async revertScheduledChange(orgId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "organization:manage_billing");
    this.requireOrganizationAccess(user, orgId);

    const existing = await subscriptionRepository.findByOrganization(orgId);
    if (!existing || !existing.scheduledChange) return;

    const reverted = existing.scheduledChange;
    const now = new Date().toISOString();
    await subscriptionRepository.update(existing.id, {
      scheduledChange: null,
      updatedAt: now,
    } as Partial<Subscription>);

    eventBus.emit("subscription.scheduled_reverted", {
      organizationId: orgId,
      revertedToPlan: reverted.toPlan,
      revertedEffectiveAt: reverted.effectiveAt,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });
  }

  /**
   * Admin-only: assign a catalog plan (optionally with per-subscription
   * overrides) to an organization. Phase 5 of dynamic plan management.
   *
   * Unlike upgrade/downgrade — which enforce tier ordering and bill the
   * full published price — assign lets a superadmin:
   *  - Hand a specific org any catalog plan (including private ones),
   *  - Attach `overrides` (custom limits/features/priceXof/validUntil),
   *  - Flip immediately (no period-end scheduling — this is an admin
   *    action, not a customer self-service one).
   *
   * Requires BOTH `organization:manage_billing` AND `subscription:override`
   * because it bypasses upgrade/downgrade guardrails. Catalog plan lookup
   * tolerates no fallback — the plan MUST exist in the catalog.
   *
   * Emits `subscription.overridden` for audit.
   */
  async assignPlan(orgId: string, dto: AssignPlanDto, user: AuthUser): Promise<Subscription> {
    this.requirePermission(user, "organization:manage_billing");
    this.requirePermission(user, "subscription:override");
    // Superadmin-only in practice (those two perms are bundled via platform:manage).
    // We don't call requireOrganizationAccess — this operation is explicitly
    // cross-tenant by design.

    const now = new Date().toISOString();
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Resolve catalog plan by id (unlike resolveEffectiveForOrg which looks
    // up by key). The UI should always pass a real catalog id.
    const plan = await planRepository.findByIdOrThrow(dto.planId);
    const effective = resolveEffective(plan, dto.overrides, new Date());
    const stored = toStoredSnapshot(effective);
    // The `plan` enum on org + subscription stays aligned with the catalog
    // `key` for backward compat with pre-Phase-3 readers.
    const planKeyForLegacy = plan.key as OrganizationPlan;

    // Price reflects the override if present, else the catalog price. This
    // keeps the "sur devis" use case sensible (priceXof set by the admin
    // when assigning a custom plan).
    const priceXof = dto.overrides?.priceXof !== undefined ? dto.overrides.priceXof : plan.priceXof;

    // Transactional: org plan + denormalization atomically.
    const previousPlan = await db.runTransaction(async (tx) => {
      const orgRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId);
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) throw new ValidationError("Organisation introuvable");
      const orgData = orgSnap.data() as Organization;

      tx.update(orgRef, {
        plan: planKeyForLegacy,
        effectiveLimits: stored.limits,
        effectiveFeatures: stored.features,
        effectivePlanKey: stored.planKey,
        effectiveComputedAt: stored.computedAt,
        updatedAt: now,
      });
      return orgData.plan;
    });

    // Subscription doc (outside the tx — not critical for atomicity).
    // Firestore rejects `undefined` values on writes, so `overrides` must be
    // either the concrete object or `null` (to explicitly clear a previous
    // override on re-assign). Only pull overrides in when the caller
    // actually provided them.
    const existing = await subscriptionRepository.findByOrganization(orgId);
    let subscription: Subscription;
    if (existing) {
      await subscriptionRepository.update(existing.id, {
        plan: planKeyForLegacy,
        planId: plan.id,
        overrides: dto.overrides ?? null,
        status: "active",
        priceXof,
        assignedBy: user.uid,
        assignedAt: now,
        cancelledAt: null,
        scheduledChange: null,
        updatedAt: now,
      } as Partial<Subscription>);
      subscription = await subscriptionRepository.findByIdOrThrow(existing.id);
    } else {
      subscription = await subscriptionRepository.create({
        organizationId: orgId,
        plan: planKeyForLegacy,
        planId: plan.id,
        overrides: dto.overrides ?? null,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd.toISOString(),
        cancelledAt: null,
        paymentMethod: null,
        priceXof,
        assignedBy: user.uid,
        assignedAt: now,
      } as Omit<Subscription, "id" | "createdAt" | "updatedAt">);
    }

    eventBus.emit("subscription.overridden", {
      organizationId: orgId,
      previousPlan,
      newPlanKey: plan.key,
      newPlanId: plan.id,
      hasOverrides: !!dto.overrides,
      validUntil: dto.overrides?.validUntil ?? null,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return subscription;
  }
}

export const subscriptionService = new SubscriptionService();
