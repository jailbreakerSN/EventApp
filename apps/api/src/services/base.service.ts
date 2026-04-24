import {
  type Organization,
  type Permission,
  type PlanFeature,
  type PlanFeatures,
  type RoleAssignment,
  type Entitlement,
  PLAN_LIMITS,
  PLAN_LIMIT_UNLIMITED,
  LEGACY_FEATURE_ENTITLEMENT_KEYS,
  LEGACY_QUOTA_ENTITLEMENT_KEYS,
  hasAnyPermission,
  hasPermission,
  isAdminSystemRole,
  resolvePermissions,
} from "@teranga/shared-types";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ForbiddenError, PlanLimitError } from "@/errors/app-error";

// ─── Effective-plan fallback helpers ─────────────────────────────────────────
//
// Phase 3 of dynamic plans: enforcement reads `org.effectiveLimits` /
// `org.effectiveFeatures` first. If these are missing (an org that predates
// the Phase 2 backfill, or an org created mid-deploy before the plan doc was
// seeded), we fall back to the hardcoded `PLAN_LIMITS` record keyed by the
// legacy `org.plan` enum. This keeps every request safe while we finish the
// rollout; Phase 6 removes the hardcoded constants once no org is missing
// effective fields.

function storedToRuntime(n: number): number {
  return n === PLAN_LIMIT_UNLIMITED ? Infinity : n;
}

function effectiveFeatures(org: Organization): PlanFeatures {
  if (org.effectiveFeatures) return org.effectiveFeatures;
  return PLAN_LIMITS[org.plan].features;
}

type LimitResource = "events" | "members" | "participantsPerEvent";

function effectiveLimit(org: Organization, resource: LimitResource): number {
  if (org.effectiveLimits) {
    const stored =
      resource === "events"
        ? org.effectiveLimits.maxEvents
        : resource === "members"
          ? org.effectiveLimits.maxMembers
          : org.effectiveLimits.maxParticipantsPerEvent;
    return storedToRuntime(stored);
  }
  // Fallback: read from the hardcoded PLAN_LIMITS table.
  const legacy = PLAN_LIMITS[org.plan];
  return resource === "events"
    ? legacy.maxEvents
    : resource === "members"
      ? legacy.maxMembers
      : legacy.maxParticipantsPerEvent;
}

/**
 * Base service providing shared permission resolution logic.
 * All domain services extend this to get consistent access control.
 */
export abstract class BaseService {
  /**
   * Throw ForbiddenError if the user lacks the given permission.
   */
  protected requirePermission(user: AuthUser, permission: Permission): void {
    if (!this.hasPermission(user, permission)) {
      throw new ForbiddenError(`Permission manquante : ${permission}`);
    }
  }

  /**
   * Check if user has a permission without throwing.
   * Useful for conditional logic (e.g., auto-approve for admins).
   */
  protected hasPermission(user: AuthUser, permission: Permission): boolean {
    const perms = this.resolveUserPermissions(user);
    return hasPermission(perms, permission);
  }

  /**
   * T5.2 — throw ForbiddenError unless the user holds AT LEAST ONE of
   * the provided permissions. Used by the per-route permission
   * tightening: a route gated on `["subscription:override",
   * "platform:manage"]` accepts either the narrow capability OR the
   * super-admin safety-net, so narrow `platform:*` roles can reach it
   * without giving them the full `platform:manage` scope.
   */
  protected requireAnyPermission(user: AuthUser, permissions: Permission[]): void {
    const perms = this.resolveUserPermissions(user);
    if (!hasAnyPermission(perms, permissions)) {
      throw new ForbiddenError(
        `Permissions manquantes (au moins une requise) : ${permissions.join(", ")}`,
      );
    }
  }

  /**
   * Throw ForbiddenError if the user doesn't belong to the organization.
   *
   * Every admin system role bypasses this check — super_admin plus the
   * five `platform:*` subroles, all of which hold `platform:manage`
   * today (see DEFAULT_ROLE_PERMISSIONS in shared-types). The exemption
   * is sourced from the canonical `isAdminSystemRole` predicate so this
   * gate cannot drift from the email-verification gate or the
   * web-backoffice `(admin)` shell access list. When closure C.1
   * narrows per-route permissions (e.g. platform:finance no longer
   * implying platform:manage), migrate this bypass to a permission
   * check (`hasPermission(user, "platform:manage")`) at the same time.
   */
  protected requireOrganizationAccess(user: AuthUser, organizationId: string): void {
    if (user.roles.some(isAdminSystemRole)) return;
    if (user.organizationId !== organizationId) {
      throw new ForbiddenError("Accès refusé aux ressources de cette organisation");
    }
  }

  /**
   * Throw PlanLimitError if the organization's effective plan does not include
   * the given feature. Reads `org.effectiveFeatures` with a safe fallback to
   * the hardcoded `PLAN_LIMITS[org.plan].features` record when the
   * denormalization is missing (e.g. pre-backfill org).
   */
  protected requirePlanFeature(org: Organization, feature: PlanFeature): void {
    const features = effectiveFeatures(org);
    if (!features[feature]) {
      throw new PlanLimitError(
        `La fonctionnalité « ${feature} » n'est pas disponible sur le plan ${org.effectivePlanKey ?? org.plan}`,
        { feature, plan: org.effectivePlanKey ?? org.plan },
      );
    }
  }

  /**
   * Check a numeric plan limit without throwing.
   * Returns the comparison so the caller can decide (throw, waitlist, etc.).
   *
   * Reads `org.effectiveLimits` with a safe fallback to `PLAN_LIMITS[org.plan]`
   * when the denormalization is missing.
   */
  protected checkPlanLimit(
    org: Organization,
    resource: LimitResource,
    current: number,
  ): { allowed: boolean; current: number; limit: number } {
    const limit = effectiveLimit(org, resource);
    return {
      allowed: !isFinite(limit) || current < limit,
      current,
      limit,
    };
  }

  /**
   * Throw PlanLimitError if the organization does not hold the given
   * entitlement key as a `{ kind: "boolean", value: true }` entry.
   *
   * Back-compat: if the org has no `effectiveEntitlements` field (legacy
   * plan, pre-backfill org, or a plan that hasn't opted into the unified
   * model yet), we synthesise a lookup by mapping the entitlement key back
   * to its legacy counterpart and delegating to `requirePlanFeature`. The
   * 14 existing call sites that still use `requirePlanFeature` are
   * unaffected; new callers (SMS packs, API access gated by the unified
   * model) use this helper directly.
   *
   * Example:
   *   this.requireEntitlement(org, "feature.smsNotifications");
   *   this.requireEntitlement(org, "quota.sms.monthly");  // time-bounded, etc.
   *
   * Throws `PlanLimitError` if the entitlement is missing or disabled,
   * including when a `quota` entitlement has been exhausted (limit === 0).
   */
  protected requireEntitlement(org: Organization, key: string): void {
    const ent = org.effectiveEntitlements?.[key];

    // Path 1 — the unified field is present and covers this key.
    if (ent !== undefined) {
      if (this.isEntitlementActive(ent)) return;
      throw new PlanLimitError(
        `La fonctionnalité « ${key} » n'est pas disponible sur le plan ${org.effectivePlanKey ?? org.plan}`,
        { feature: key, plan: org.effectivePlanKey ?? org.plan },
      );
    }

    // Path 2 — legacy fallback. If the key maps to one of the 11 known
    // boolean features, delegate to `requirePlanFeature` so the org doc's
    // pre-entitlement denormalization still drives the decision.
    const legacyFeature = this.resolveLegacyFeatureKey(key);
    if (legacyFeature) {
      this.requirePlanFeature(org, legacyFeature);
      return;
    }

    // Path 3 — unknown key, no legacy mapping, no entitlement present.
    // Deny-by-default: a feature we know nothing about MUST NOT be granted
    // silently. Callers can detect this via the thrown error code.
    throw new PlanLimitError(
      `La fonctionnalité « ${key} » n'est pas disponible sur le plan ${org.effectivePlanKey ?? org.plan}`,
      { feature: key, plan: org.effectivePlanKey ?? org.plan },
    );
  }

  /**
   * Check a quota without throwing. Reads
   * `org.effectiveEntitlements[key]` if it's a `{ kind: "quota" }` entry;
   * falls back to `checkPlanLimit` for the three pre-defined resources
   * (`quota.events` / `quota.participantsPerEvent` / `quota.members`).
   * For any other key with no entitlement present, returns `allowed:
   * false` with a limit of 0 — callers that want "unknown = unlimited"
   * semantics should declare an explicit `{ kind: "quota", limit: -1 }`
   * entitlement on the plan.
   *
   * Returned shape mirrors `checkPlanLimit` for drop-in compatibility at
   * call sites that want to migrate incrementally.
   */
  protected checkQuota(
    org: Organization,
    key: string,
    current: number,
  ): { allowed: boolean; current: number; limit: number } {
    const ent = org.effectiveEntitlements?.[key];

    // Path 1 — a quota entitlement is present.
    if (ent?.kind === "quota") {
      const limit = storedToRuntime(ent.limit);
      return { allowed: !isFinite(limit) || current < limit, current, limit };
    }

    // Path 2 — entitlement present but wrong kind. The plan declares this
    // key as a boolean (or tiered); callers asking for a quota are
    // misconfigured. Surface as "denied" so the bug shows up loudly in UI
    // rather than silently passing a free-for-all.
    if (ent) {
      return { allowed: false, current, limit: 0 };
    }

    // Path 3 — legacy fallback for the three pre-defined resources.
    const legacyResource = this.resolveLegacyQuotaKey(key);
    if (legacyResource) {
      return this.checkPlanLimit(org, legacyResource, current);
    }

    // Path 4 — unknown key. Deny-by-default.
    return { allowed: false, current, limit: 0 };
  }

  private isEntitlementActive(ent: Entitlement): boolean {
    if (ent.kind === "boolean") return ent.value;
    if (ent.kind === "quota") {
      const runtime = storedToRuntime(ent.limit);
      return !isFinite(runtime) || runtime > 0;
    }
    // `tiered` kind — schema-reserved for metered billing. Treat as
    // active in the MVP (a plan that declares a tier schedule has opted
    // in to the capability); the resolver-level enforcement against tier
    // bands lands with the first real metered plan.
    return true;
  }

  private resolveLegacyFeatureKey(key: string): PlanFeature | undefined {
    for (const [legacy, entitlementKey] of Object.entries(LEGACY_FEATURE_ENTITLEMENT_KEYS)) {
      if (entitlementKey === key) return legacy as PlanFeature;
    }
    return undefined;
  }

  private resolveLegacyQuotaKey(key: string): LimitResource | undefined {
    if (key === LEGACY_QUOTA_ENTITLEMENT_KEYS.maxEvents) return "events";
    if (key === LEGACY_QUOTA_ENTITLEMENT_KEYS.maxMembers) return "members";
    if (key === LEGACY_QUOTA_ENTITLEMENT_KEYS.maxParticipantsPerEvent) {
      return "participantsPerEvent";
    }
    return undefined;
  }

  /**
   * Resolve effective permissions from the user's roles and organization context.
   *
   * Currently builds inline RoleAssignments from the JWT custom claims.
   * When the full RoleAssignment Firestore collection is implemented,
   * this method can be updated to fetch real assignments — all services
   * benefit automatically.
   */
  protected resolveUserPermissions(user: AuthUser): Set<Permission> {
    const assignments: RoleAssignment[] = user.roles.map((role) => ({
      id: `inline-${role}`,
      userId: user.uid,
      role,
      scope: user.organizationId ? ("organization" as const) : ("global" as const),
      organizationId: user.organizationId ?? null,
      eventId: null,
      grantedBy: "system",
      grantedAt: new Date().toISOString(),
      isActive: true,
    }));

    return resolvePermissions(assignments, {
      organizationId: user.organizationId,
    });
  }
}
