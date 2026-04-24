import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api-client";
import type {
  AdminUserQuery,
  AdminOrgQuery,
  AdminEventQuery,
  AdminVenueQuery,
  AdminPaymentQuery,
  AdminSubscriptionQuery,
  AdminInviteQuery,
  AdminAuditQuery,
  CreatePlanDto,
  UpdatePlanDto,
  AssignPlanDto,
} from "@teranga/shared-types";

// ─── Stats ──────────────────────────────────────────────────────────────────

export function useAdminStats() {
  return useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => adminApi.getStats(),
    staleTime: 30_000,
  });
}

// ─── Users ──────────────────────────────────────────────────────────────────

export function useAdminUsers(params: Partial<AdminUserQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "users", params],
    queryFn: () => adminApi.listUsers(params),
  });
}

export function useUpdateUserRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roles }: { userId: string; roles: string[] }) =>
      adminApi.updateUserRoles(userId, roles),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useUpdateUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminApi.updateUserStatus(userId, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useBulkUpdateUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, isActive }: { ids: string[]; isActive: boolean }) =>
      adminApi.bulkUpdateUserStatus(ids, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

// ─── Organizations ──────────────────────────────────────────────────────────

export function useAdminOrganizations(params: Partial<AdminOrgQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "organizations", params],
    queryFn: () => adminApi.listOrganizations(params),
  });
}

export function useVerifyOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => adminApi.verifyOrganization(orgId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "organizations"] }),
  });
}

export function useUpdateOrgStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, isActive }: { orgId: string; isActive: boolean }) =>
      adminApi.updateOrgStatus(orgId, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "organizations"] }),
  });
}

export function useBulkUpdateOrgStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, isActive }: { ids: string[]; isActive: boolean }) =>
      adminApi.bulkUpdateOrgStatus(ids, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "organizations"] }),
  });
}

// ─── Events ─────────────────────────────────────────────────────────────────

export function useAdminEvents(params: Partial<AdminEventQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "events", params],
    queryFn: () => adminApi.listEvents(params),
  });
}

// ─── Venues (admin moderation surface) ──────────────────────────────────────
// Use this hook on /admin/venues, NOT `useVenues()`. The latter calls the
// public endpoint which is hardcoded to approved-only and silently drops
// the `status` filter — the bug behind the "le tableau n'est pas filtré"
// report when arriving from the inbox `/admin/venues?status=pending` link.

export function useAdminVenues(params: Partial<AdminVenueQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "venues", params],
    queryFn: () => adminApi.listVenues(params),
  });
}

// ─── Payments (admin finance-ops surface) ───────────────────────────────────
// Use this on /admin/payments (and the inbox deep-link for
// `payments.failed`). The public `paymentsApi` hooks are event-scoped
// and won't carry the failed row unless the operator already knows
// which event to drill into.

export function useAdminPayments(params: Partial<AdminPaymentQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "payments", params],
    queryFn: () => adminApi.listPayments(params),
  });
}

// ─── Subscriptions (admin billing-ops surface) ─────────────────────────────
// Powers the past_due section of /admin/subscriptions (+ the inbox
// `subscriptions.past_due` deep-link).

export function useAdminSubscriptions(params: Partial<AdminSubscriptionQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "subscriptions", params],
    queryFn: () => adminApi.listSubscriptions(params),
  });
}

// ─── Invites (admin cross-org surface) ─────────────────────────────────────
// Powers /admin/invites and the inbox `invites.expired` deep-link.
// The per-org invites endpoint stays scoped to its org for the
// organization billing page; this hook is platform-wide ops.

export function useAdminInvites(params: Partial<AdminInviteQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "invites", params],
    queryFn: () => adminApi.listInvites(params),
  });
}

// ─── Audit Logs ─────────────────────────────────────────────────────────────

export function useAdminAuditLogs(params: Partial<AdminAuditQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "audit-logs", params],
    queryFn: () => adminApi.listAuditLogs(params),
  });
}

// ─── Plan Catalog ───────────────────────────────────────────────────────────

export function useAdminPlans(params: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: ["admin", "plans", params],
    queryFn: () => adminApi.listPlans(params),
    staleTime: 30_000,
  });
}

/**
 * Phase 7+ item #5 — MRR / cohort dashboard data hook.
 *
 * Point-in-time snapshot. 5-min client staleTime matches the operator's
 * refresh cadence without hammering the endpoint (each call fans out
 * orgs × event-count reads on the server).
 */
export function useAdminPlanAnalytics() {
  return useQuery({
    queryKey: ["admin", "plans", "analytics"],
    queryFn: () => adminApi.getPlanAnalytics(),
    staleTime: 5 * 60_000,
  });
}

export function useAdminPlan(planId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "plans", "detail", planId],
    queryFn: () => adminApi.getPlan(planId!),
    enabled: !!planId,
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePlanDto) => adminApi.createPlan(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "plans"] }),
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, dto }: { planId: string; dto: UpdatePlanDto }) =>
      adminApi.updatePlan(planId, dto),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["admin", "plans"] });
      qc.invalidateQueries({ queryKey: ["admin", "plans", "detail", variables.planId] });
    },
  });
}

/**
 * Phase 7+ item #6 — dry-run / impact preview hook.
 *
 * Call this with the current dirty form state to see how many (and which)
 * organisations would be affected if the admin presses Save. Does not
 * mutate anything. Debounce at the call site so we don't hammer the
 * endpoint on every keystroke.
 */
export function usePreviewPlanChange() {
  return useMutation({
    mutationFn: ({ planId, dto }: { planId: string; dto: UpdatePlanDto }) =>
      adminApi.previewPlanChange(planId, dto),
  });
}

export function useArchivePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => adminApi.archivePlan(planId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "plans"] }),
  });
}

// ─── Per-org subscription assign (Phase 5: admin override) ──────────────────

export function useAdminOrgSubscription(orgId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "organizations", "subscription", orgId],
    queryFn: () => adminApi.getOrgSubscription(orgId!),
    enabled: !!orgId,
  });
}

export function useAssignPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, dto }: { orgId: string; dto: AssignPlanDto }) =>
      adminApi.assignPlan(orgId, dto),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["admin", "organizations"] });
      qc.invalidateQueries({
        queryKey: ["admin", "organizations", "subscription", variables.orgId],
      });
    },
  });
}
