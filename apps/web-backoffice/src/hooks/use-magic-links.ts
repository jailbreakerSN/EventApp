"use client";

/**
 * Organizer overhaul — Phase O10.
 *
 * React Query hooks for magic links:
 *   - `useIssueMagicLink`  — POST, returns the plaintext token (only
 *                            place it's ever surfaced).
 *   - `useRevokeMagicLink` — POST :tokenHash/revoke.
 *   - `useVerifyMagicLink` — UNAUTHENTICATED GET; powers the
 *                            speaker / sponsor portal landing pages.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { IssueMagicLinkDto, MagicLink, MagicLinkVerifyResponse } from "@teranga/shared-types";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export function useIssueMagicLink() {
  return useMutation({
    mutationFn: async (dto: IssueMagicLinkDto): Promise<{ token: string; record: MagicLink }> => {
      const res = await api.post<ApiEnvelope<{ token: string; record: MagicLink }>>(
        "/v1/magic-links",
        dto,
      );
      return res.data;
    },
  });
}

export function useRevokeMagicLink() {
  return useMutation({
    mutationFn: async (tokenHash: string): Promise<MagicLink> => {
      const res = await api.post<ApiEnvelope<MagicLink>>(`/v1/magic-links/${tokenHash}/revoke`, {});
      return res.data;
    },
  });
}

/**
 * Verify a magic-link token. UNAUTHENTICATED — we deliberately do
 * NOT route through `api.get()` because that helper attaches a
 * Firebase bearer token, and the verify endpoint is auth-less by
 * design. Direct `fetch` with no Authorization header.
 */
export function useVerifyMagicLink(token: string | null) {
  return useQuery({
    queryKey: ["magic-link-verify", token],
    queryFn: async (): Promise<MagicLinkVerifyResponse> => {
      const url = `${API_URL}/v1/magic-links/verify?token=${encodeURIComponent(token!)}`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        let message = `Échec de la vérification (${res.status})`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error?.message) message = body.error.message;
        } catch {
          // Body wasn't JSON.
        }
        throw new Error(message);
      }
      const body = (await res.json()) as ApiEnvelope<MagicLinkVerifyResponse>;
      return body.data;
    },
    enabled: Boolean(token),
    // The verify endpoint stamps `firstUsedAt` server-side on the
    // first call; subsequent re-fetches don't double-record. We
    // still set staleTime to 5 min so React Query doesn't re-fire
    // verify on every focus event.
    staleTime: 5 * 60 * 1000,
    retry: false, // 410 / 404 are terminal — no point retrying.
  });
}
