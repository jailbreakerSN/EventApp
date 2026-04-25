import {
  type PlanCoupon,
  type CreatePlanCouponDto,
  type UpdatePlanCouponDto,
  type AdminCouponQuery,
  type ValidateCouponResponse,
  type BillingCycle,
  type Plan,
  computeCouponDiscount,
} from "@teranga/shared-types";
import { type Transaction } from "firebase-admin/firestore";
import { db, COLLECTIONS } from "@/config/firebase";
import { BaseService } from "./base.service";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import {
  ConflictError,
  NotFoundError,
  PlanLimitError,
  ValidationError,
} from "@/errors/app-error";
import type { PaginatedResult } from "@/repositories/base.repository";

// ─── Plan-level coupons service (Phase 7+ item #7) ────────────────────────
//
// Public surface:
//   - `validateForPreview`   — dry-run; UI calls before submit for preview.
//   - `applyInTransaction`   — called from `subscription.service.upgrade`
//                              inside the org+sub txn. Validates, checks
//                              caps, writes the redemption doc + bumps
//                              `usedCount` atomically.
//   - `list` / `get` / `create` / `update` / `archive` — admin CRUD.
//
// Design choices:
//   - **Code as doc id**: `planCoupons/{CODE}` — single-read lookup by
//     code, no composite index needed, case-insensitive match via the
//     schema's uppercase-only constraint (`PlanCouponCodeSchema`).
//   - **Per-org cap**: queried from `couponRedemptions` inside the apply
//     txn so two concurrent upgrades can't double-redeem. O(1)
//     composite index on `(couponId, organizationId)`.
//   - **Snapshot-on-redeem**: every redemption doc copies the
//     coupon's discountType/Value at redeem time, so later edits to
//     the coupon never retroactively change historical redemptions.

class PlanCouponService extends BaseService {
  /**
   * Super-admin only. Creates a coupon with a normalized doc id (= code).
   * Throws `ConflictError` if the code already exists (a coupon code is
   * unique globally — we don't scope by planId).
   */
  async create(dto: CreatePlanCouponDto, user: AuthUser): Promise<PlanCoupon> {
    this.requirePermission(user, "platform:manage");

    const now = new Date().toISOString();
    const ref = db.collection(COLLECTIONS.PLAN_COUPONS).doc(dto.code);

    const payload: PlanCoupon = {
      id: dto.code, // doc id = code so lookups + the `id` field stay aligned
      code: dto.code,
      label: dto.label ?? null,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      appliedPlanIds: dto.appliedPlanIds ?? null,
      appliedCycles: dto.appliedCycles ?? null,
      maxUses: dto.maxUses ?? null,
      maxUsesPerOrg: dto.maxUsesPerOrg ?? null,
      usedCount: 0,
      startsAt: dto.startsAt ?? null,
      expiresAt: dto.expiresAt ?? null,
      isActive: true,
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };

    // Transactional create so a race between two super-admins creating
    // the same code surfaces as a ConflictError instead of a silent
    // overwrite.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        throw new ConflictError(`Un coupon avec le code ${dto.code} existe déjà.`);
      }
      tx.set(ref, payload);
    });

    eventBus.emit("plan_coupon.created", {
      couponId: payload.id,
      code: payload.code,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return payload;
  }

  async get(couponId: string, user: AuthUser): Promise<PlanCoupon> {
    this.requirePermission(user, "platform:manage");
    const snap = await db.collection(COLLECTIONS.PLAN_COUPONS).doc(couponId).get();
    if (!snap.exists) throw new NotFoundError("PlanCoupon", couponId);
    return snap.data() as PlanCoupon;
  }

  async update(
    couponId: string,
    dto: UpdatePlanCouponDto,
    user: AuthUser,
  ): Promise<PlanCoupon> {
    this.requirePermission(user, "platform:manage");

    const ref = db.collection(COLLECTIONS.PLAN_COUPONS).doc(couponId);
    const now = new Date().toISOString();
    const updated = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError("PlanCoupon", couponId);
      const patch: Record<string, unknown> = { updatedAt: now };
      for (const [k, v] of Object.entries(dto)) {
        if (v !== undefined) patch[k] = v;
      }
      tx.update(ref, patch);
      const merged = { ...(snap.data() as PlanCoupon), ...patch };
      return merged as PlanCoupon;
    });

    eventBus.emit("plan_coupon.updated", {
      couponId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
      changes: Object.keys(dto).filter(
        (k) => (dto as Record<string, unknown>)[k] !== undefined,
      ),
    });

    return updated;
  }

  /** Soft-delete via `isActive: false`. Keeps redemption history intact. */
  async archive(couponId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "platform:manage");
    const ref = db.collection(COLLECTIONS.PLAN_COUPONS).doc(couponId);
    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError("PlanCoupon", couponId);
      tx.update(ref, { isActive: false, updatedAt: now });
    });
    eventBus.emit("plan_coupon.archived", {
      couponId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });
  }

  async list(
    query: AdminCouponQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<PlanCoupon>> {
    this.requirePermission(user, "platform:manage");

    let q = db
      .collection(COLLECTIONS.PLAN_COUPONS)
      .orderBy("createdAt", "desc") as FirebaseFirestore.Query<FirebaseFirestore.DocumentData>;
    if (query.code) q = q.where("code", "==", query.code.toUpperCase());
    if (query.isActive !== undefined) q = q.where("isActive", "==", query.isActive);
    if (query.planId) q = q.where("appliedPlanIds", "array-contains", query.planId);

    const countSnap = await q.count().get();
    const total = countSnap.data().count;
    const snap = await q
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .get();

    const data = snap.docs.map((d) => d.data() as PlanCoupon);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  /**
   * Public dry-run. Validates a coupon against a target plan + cycle and
   * returns the discount preview for the UI. Zero side effect — no
   * `usedCount` bump, no redemption doc. The real apply path runs
   * again inside the upgrade transaction to catch races between this
   * preview and the commit.
   */
  async validateForPreview(params: {
    code: string;
    plan: Plan;
    cycle?: BillingCycle;
    organizationId: string;
  }): Promise<ValidateCouponResponse> {
    const coupon = await this.loadActiveCoupon(params.code);
    this.assertCouponApplies(coupon, params.plan, params.cycle);
    await this.assertCapNotExceeded(coupon, params.organizationId);

    const originalPriceXof = this.resolvePriceXof(params.plan, params.cycle);
    const { discountXof, finalPriceXof } = computeCouponDiscount(
      originalPriceXof,
      coupon.discountType,
      coupon.discountValue,
    );

    return {
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      originalPriceXof,
      discountXof,
      finalPriceXof,
    };
  }

  /**
   * Transactional apply. Caller (subscription.service.upgrade) owns the
   * transaction; this method performs all reads + the bump + redemption
   * write inside it. Returns the discount context so the caller can
   * write `subscription.appliedCoupon` + `subscription.priceXof` with
   * the matching values.
   *
   * Throws `PlanLimitError` on cap-exceeded / scope-mismatch /
   * expired / inactive — so the upgrade aborts cleanly.
   */
  async applyInTransaction(
    tx: Transaction,
    params: {
      code: string;
      plan: Plan;
      cycle?: BillingCycle;
      organizationId: string;
      subscriptionId: string;
      actorId: string;
    },
  ): Promise<{
    coupon: PlanCoupon;
    originalPriceXof: number;
    discountXof: number;
    finalPriceXof: number;
    redemptionRef: FirebaseFirestore.DocumentReference;
  }> {
    const normalized = params.code.toUpperCase();
    const ref = db.collection(COLLECTIONS.PLAN_COUPONS).doc(normalized);

    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new PlanLimitError(`Coupon introuvable : ${params.code}`, {
        feature: "plan_coupon.not_found",
        plan: params.plan.key,
      });
    }
    const coupon = snap.data() as PlanCoupon;

    this.assertCouponActive(coupon);
    this.assertCouponApplies(coupon, params.plan, params.cycle);
    await this.assertCapNotExceededTx(tx, coupon, params.organizationId);

    const originalPriceXof = this.resolvePriceXof(params.plan, params.cycle);
    const { discountXof, finalPriceXof } = computeCouponDiscount(
      originalPriceXof,
      coupon.discountType,
      coupon.discountValue,
    );

    const redemptionRef = db.collection(COLLECTIONS.COUPON_REDEMPTIONS).doc();
    const now = new Date().toISOString();

    tx.update(ref, {
      usedCount: (coupon.usedCount ?? 0) + 1,
      updatedAt: now,
    });
    tx.set(redemptionRef, {
      id: redemptionRef.id,
      couponId: coupon.id,
      couponCode: coupon.code,
      organizationId: params.organizationId,
      subscriptionId: params.subscriptionId,
      planId: params.plan.id,
      cycle: params.cycle,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      originalPriceXof,
      discountAppliedXof: discountXof,
      finalPriceXof,
      redeemedBy: params.actorId,
      redeemedAt: now,
    });

    return { coupon, originalPriceXof, discountXof, finalPriceXof, redemptionRef };
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  private async loadActiveCoupon(code: string): Promise<PlanCoupon> {
    const normalized = code.toUpperCase();
    const snap = await db.collection(COLLECTIONS.PLAN_COUPONS).doc(normalized).get();
    if (!snap.exists) {
      throw new PlanLimitError(`Coupon introuvable : ${code}`, {
        feature: "plan_coupon.not_found",
        plan: "unknown",
      });
    }
    const coupon = snap.data() as PlanCoupon;
    this.assertCouponActive(coupon);
    return coupon;
  }

  private assertCouponActive(coupon: PlanCoupon): void {
    if (!coupon.isActive) {
      throw new PlanLimitError("Ce coupon est désactivé.", {
        feature: "plan_coupon.inactive",
        plan: "unknown",
      });
    }
    const now = Date.now();
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) {
      throw new PlanLimitError("Ce coupon n'est pas encore actif.", {
        feature: "plan_coupon.not_yet_active",
        plan: "unknown",
      });
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= now) {
      throw new PlanLimitError("Ce coupon a expiré.", {
        feature: "plan_coupon.expired",
        plan: "unknown",
      });
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new PlanLimitError("Ce coupon a atteint sa limite d'utilisation.", {
        feature: "plan_coupon.max_uses_reached",
        plan: "unknown",
      });
    }
  }

  private assertCouponApplies(
    coupon: PlanCoupon,
    plan: Plan,
    cycle: BillingCycle | undefined,
  ): void {
    if (
      coupon.appliedPlanIds &&
      coupon.appliedPlanIds.length > 0 &&
      !coupon.appliedPlanIds.includes(plan.id)
    ) {
      throw new PlanLimitError(`Ce coupon ne s'applique pas au plan ${plan.key}.`, {
        feature: "plan_coupon.plan_not_eligible",
        plan: plan.key,
      });
    }
    if (
      cycle &&
      coupon.appliedCycles &&
      coupon.appliedCycles.length > 0 &&
      !coupon.appliedCycles.includes(cycle)
    ) {
      throw new PlanLimitError(`Ce coupon ne s'applique pas au cycle ${cycle}.`, {
        feature: "plan_coupon.cycle_not_eligible",
        plan: plan.key,
      });
    }
  }

  private async assertCapNotExceeded(
    coupon: PlanCoupon,
    organizationId: string,
  ): Promise<void> {
    if (coupon.maxUsesPerOrg === null) return;
    const countSnap = await db
      .collection(COLLECTIONS.COUPON_REDEMPTIONS)
      .where("couponId", "==", coupon.id)
      .where("organizationId", "==", organizationId)
      .count()
      .get();
    if (countSnap.data().count >= coupon.maxUsesPerOrg) {
      throw new PlanLimitError("Votre organisation a déjà utilisé ce coupon.", {
        feature: "plan_coupon.org_cap_reached",
        plan: "unknown",
      });
    }
  }

  private async assertCapNotExceededTx(
    tx: Transaction,
    coupon: PlanCoupon,
    organizationId: string,
  ): Promise<void> {
    if (coupon.maxUsesPerOrg === null) return;
    // Firestore transactions don't support `.count()`, so we fetch the
    // matching docs and count in memory. The cap is expected to be
    // small (per-org caps are typically 1..5) so the limit-bound read
    // is cheap even on busy coupons.
    const snap = await tx.get(
      db
        .collection(COLLECTIONS.COUPON_REDEMPTIONS)
        .where("couponId", "==", coupon.id)
        .where("organizationId", "==", organizationId)
        .limit(coupon.maxUsesPerOrg + 1),
    );
    if (snap.size >= coupon.maxUsesPerOrg) {
      throw new PlanLimitError("Votre organisation a déjà utilisé ce coupon.", {
        feature: "plan_coupon.org_cap_reached",
        plan: "unknown",
      });
    }
  }

  private resolvePriceXof(plan: Plan, cycle: BillingCycle | undefined): number {
    if (cycle === "annual") {
      if (plan.annualPriceXof == null) {
        throw new ValidationError(
          "Le plan ne propose pas de cycle annuel — impossible de valider le coupon.",
        );
      }
      return plan.annualPriceXof;
    }
    return plan.priceXof;
  }
}

export const planCouponService = new PlanCouponService();
