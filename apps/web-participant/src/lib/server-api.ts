import type { Event, EventSearchQuery, SpeakerProfile, Session } from "@teranga/shared-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
}

async function serverFetch<T>(path: string): Promise<T> {
  // 5s timeout so page builds don't hang when the API is unreachable
  // (e.g., first-time staging deploy before Cloud Run service exists).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 60 },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${res.statusText}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const serverEventsApi = {
  search: (query: Partial<EventSearchQuery> = {}) =>
    serverFetch<PaginatedResponse<Event>>(`/v1/events${buildQuery(query)}`),

  getBySlug: (slug: string) =>
    serverFetch<ApiResponse<Event>>(`/v1/events/by-slug/${encodeURIComponent(slug)}`),

  getById: (id: string) =>
    serverFetch<ApiResponse<Event>>(`/v1/events/${id}`),
};

export const serverSpeakersApi = {
  listByEvent: (eventId: string) =>
    serverFetch<PaginatedResponse<SpeakerProfile>>(`/v1/events/${eventId}/speakers`),
};

export const serverSessionsApi = {
  listByEvent: (eventId: string) =>
    serverFetch<PaginatedResponse<Session>>(`/v1/events/${eventId}/sessions`),
};

export type { ApiResponse, PaginatedResponse };
