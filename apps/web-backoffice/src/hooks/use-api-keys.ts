"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiKeysApi } from "@/lib/api-client";
import type { CreateApiKeyRequest, RotateApiKeyRequest } from "@teranga/shared-types";

/**
 * T2.3 — React Query hooks for the organization-scoped API keys UI.
 *
 * Cache discipline:
 *   - List queries keyed by `(orgId, page, limit)` so pagination works.
 *   - Detail queries keyed by `(orgId, apiKeyId)`.
 *   - Every mutation invalidates the list so the status column updates
 *     without a manual reload.
 */

const listKey = (orgId: string, query: { page?: number; limit?: number } = {}) =>
  ["api-keys", "list", orgId, query.page ?? 1, query.limit ?? 20] as const;

const detailKey = (orgId: string, apiKeyId: string) =>
  ["api-keys", "detail", orgId, apiKeyId] as const;

// Cache-tuning rationale: keys rarely change. Every tab-focus re-fetch
// is noise — set a generous staleTime (30 s) and disable the
// refetch-on-focus default. Mutations invalidate the cache explicitly
// so a freshly-rotated key shows up immediately without polling.
const API_KEY_STALE_MS = 30_000;

export function useApiKeys(orgId: string, query: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: listKey(orgId, query),
    queryFn: () => apiKeysApi.list(orgId, query),
    enabled: !!orgId,
    staleTime: API_KEY_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

export function useApiKey(orgId: string, apiKeyId: string | null) {
  return useQuery({
    queryKey: apiKeyId ? detailKey(orgId, apiKeyId) : ["api-keys", "detail", orgId, null],
    queryFn: () => apiKeysApi.get(orgId, apiKeyId!),
    enabled: !!orgId && !!apiKeyId,
    staleTime: API_KEY_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

export function useCreateApiKey(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateApiKeyRequest) => apiKeysApi.create(orgId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys", "list", orgId] });
    },
  });
}

export function useRevokeApiKey(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ apiKeyId, reason }: { apiKeyId: string; reason?: string }) =>
      apiKeysApi.revoke(orgId, apiKeyId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys", "list", orgId] });
    },
  });
}

export function useRotateApiKey(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ apiKeyId, dto }: { apiKeyId: string; dto?: RotateApiKeyRequest }) =>
      apiKeysApi.rotate(orgId, apiKeyId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys", "list", orgId] });
    },
  });
}
