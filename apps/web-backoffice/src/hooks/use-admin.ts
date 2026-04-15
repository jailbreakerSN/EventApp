import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api-client";
import type {
  AdminUserQuery,
  AdminOrgQuery,
  AdminEventQuery,
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

// ─── Events ─────────────────────────────────────────────────────────────────

export function useAdminEvents(params: Partial<AdminEventQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "events", params],
    queryFn: () => adminApi.listEvents(params),
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
