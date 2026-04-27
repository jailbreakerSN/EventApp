"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { badgeTemplatesApi, badgesApi } from "@/lib/api-client";
import type {
  BadgeTemplateQuery,
  CreateBadgeTemplateDto,
  UpdateBadgeTemplateDto,
} from "@teranga/shared-types";

// ─── Badge Template Queries ────────────────────────────────────────────────

/**
 * Doctrine-compliant template listing. The full query (q, isDefault,
 * orderBy, orderDir, page, limit) is part of the queryKey so React Query
 * refetches cleanly whenever the URL state changes — same wiring as
 * /venues and /admin/users. `placeholderData: keepPreviousData` is
 * intentionally NOT set here; the surface is small enough that a hard
 * refetch is acceptable and the data freshness is more valuable than
 * the layout-stability of stale rows during transition.
 */
export function useBadgeTemplates(
  organizationId: string | undefined,
  params: Partial<Omit<BadgeTemplateQuery, "organizationId">> = {},
) {
  return useQuery({
    queryKey: ["badge-templates", organizationId, params],
    queryFn: () => badgeTemplatesApi.list(organizationId!, params),
    enabled: !!organizationId,
  });
}

export function useBadgeTemplate(templateId: string) {
  return useQuery({
    queryKey: ["badge-templates", "detail", templateId],
    queryFn: () => badgeTemplatesApi.getById(templateId),
    enabled: !!templateId,
  });
}

// ─── Badge Template Mutations ──────────────────────────────────────────────

export function useCreateBadgeTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateBadgeTemplateDto) => badgeTemplatesApi.create(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badge-templates"] });
    },
  });
}

export function useUpdateBadgeTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, dto }: { templateId: string; dto: Partial<UpdateBadgeTemplateDto> }) =>
      badgeTemplatesApi.update(templateId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badge-templates"] });
    },
  });
}

export function useDeleteBadgeTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => badgeTemplatesApi.remove(templateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badge-templates"] });
    },
  });
}

// ─── Badge Generation Mutations ────────────────────────────────────────────

export function useGenerateBadge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, templateId }: { registrationId: string; templateId: string }) =>
      badgesApi.generate(registrationId, templateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badges"] });
    },
  });
}

export function useBulkGenerateBadges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, templateId }: { eventId: string; templateId: string }) =>
      badgesApi.bulkGenerate(eventId, templateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badges"] });
    },
  });
}
