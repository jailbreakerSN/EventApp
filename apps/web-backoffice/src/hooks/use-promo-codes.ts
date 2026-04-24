import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

async function fetchWithAuth(url: string, options?: RequestInit) {
  const { getAuth } = await import("firebase/auth");
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  // Don't advertise JSON when there's no body — Fastify's default JSON
  // parser rejects empty payloads with 400 (FST_ERR_CTP_EMPTY_JSON_BODY)
  // when the header is set. Matches the guard in src/lib/api-client.ts.
  const hasBody = options?.body !== undefined && options?.body !== null;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Erreur ${res.status}`);
  }
  return res.json();
}

export function useEventPromoCodes(eventId: string) {
  return useQuery({
    queryKey: ["promo-codes", eventId],
    queryFn: () => fetchWithAuth(`${API_URL}/v1/events/${eventId}/promo-codes`),
    enabled: !!eventId,
  });
}

export function useCreatePromoCode(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      code: string;
      discountType: "percentage" | "fixed";
      discountValue: number;
      maxUses?: number;
      expiresAt?: string;
      ticketTypeIds?: string[];
    }) =>
      fetchWithAuth(`${API_URL}/v1/events/${eventId}/promo-codes`, {
        method: "POST",
        body: JSON.stringify({ ...data, eventId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["promo-codes", eventId] });
    },
  });
}

export function useDeactivatePromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (promoCodeId: string) =>
      fetchWithAuth(`${API_URL}/v1/promo-codes/${promoCodeId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["promo-codes"] });
    },
  });
}
