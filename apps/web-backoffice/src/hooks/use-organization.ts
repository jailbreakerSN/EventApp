"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { organizationsApi, invitesApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import type {
  UpdateOrganizationDto,
  CreateInviteDto,
  AnalyticsQuery,
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
    mutationFn: (dto: Partial<UpdateOrganizationDto>) =>
      organizationsApi.update(orgId!, dto),
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

export function useOrgAnalytics(query: Partial<AnalyticsQuery> = {}) {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  return useQuery({
    queryKey: ["analytics", orgId, query],
    queryFn: () => organizationsApi.getAnalytics(orgId!, query),
    enabled: !!orgId,
  });
}
