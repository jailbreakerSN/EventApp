"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { organizationsApi, invitesApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import type {
  UpdateOrganizationDto,
  CreateInviteDto,
  AnalyticsQuery,
  OrganizationPlan,
} from "@teranga/shared-types";

export function useOrganization() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  return useQuery({
    queryKey: ["organization", orgId],
    queryFn: () => organizationsApi.getById(orgId!),
    enabled: !!orgId,
  });
}

export function useUpdateOrganization() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (dto: Partial<UpdateOrganizationDto>) => organizationsApi.update(orgId!, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organization", orgId] }),
  });
}

export function useOrgInvites() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  return useQuery({
    queryKey: ["invites", orgId],
    queryFn: () => invitesApi.list(orgId!),
    enabled: !!orgId,
  });
}

export function useCreateInvite() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateInviteDto) => invitesApi.create(orgId!, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites", orgId] }),
  });
}

export function useRevokeInvite() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (inviteId: string) => invitesApi.revoke(orgId!, inviteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites", orgId] }),
  });
}

export function useRemoveMember() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => organizationsApi.removeMember(orgId!, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organization", orgId] }),
  });
}

export function useUpdateMemberRole() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      organizationsApi.updateMemberRole(orgId!, userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organization", orgId] }),
  });
}

export function useOrgAnalytics(query: Partial<AnalyticsQuery> = {}) {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  return useQuery({
    queryKey: ["analytics", orgId, query],
    queryFn: () => organizationsApi.getAnalytics(orgId!, query),
    enabled: !!orgId,
  });
}

export function useSubscription() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  return useQuery({
    queryKey: ["subscription", orgId],
    queryFn: () => organizationsApi.getSubscription(orgId!),
    enabled: !!orgId,
  });
}

export function usePlanUsage() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  return useQuery({
    queryKey: ["plan-usage", orgId],
    queryFn: () => organizationsApi.getUsage(orgId!),
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export function useUpgradePlan() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (plan: OrganizationPlan) => organizationsApi.upgradePlan(orgId!, plan),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization", orgId] });
      qc.invalidateQueries({ queryKey: ["subscription", orgId] });
      qc.invalidateQueries({ queryKey: ["plan-usage", orgId] });
    },
  });
}

export function useDowngradePlan() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: { plan: OrganizationPlan; immediate?: boolean }) =>
      organizationsApi.downgradePlan(orgId!, vars.plan, { immediate: vars.immediate }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization", orgId] });
      qc.invalidateQueries({ queryKey: ["subscription", orgId] });
      qc.invalidateQueries({ queryKey: ["plan-usage", orgId] });
    },
  });
}

export function useCancelSubscription() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: { immediate?: boolean; reason?: string } = {}) =>
      organizationsApi.cancelSubscription(orgId!, vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization", orgId] });
      qc.invalidateQueries({ queryKey: ["subscription", orgId] });
      qc.invalidateQueries({ queryKey: ["plan-usage", orgId] });
    },
  });
}

/**
 * Revert a previously-scheduled downgrade/cancel. User clicks
 * "Annuler le changement" on the banner that appears when
 * `subscription.scheduledChange` is present.
 */
export function useRevertScheduledChange() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => organizationsApi.revertScheduledChange(orgId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscription", orgId] });
    },
  });
}
