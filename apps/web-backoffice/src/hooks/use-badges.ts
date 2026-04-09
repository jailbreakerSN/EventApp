"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { badgeTemplatesApi, badgesApi } from "@/lib/api-client";
import type { CreateBadgeTemplateDto, UpdateBadgeTemplateDto } from "@teranga/shared-types";

// ─── Badge Template Queries ────────────────────────────────────────────────

export function useBadgeTemplates(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["badge-templates", organizationId],
    queryFn: () => badgeTemplatesApi.list(organizationId!),
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
