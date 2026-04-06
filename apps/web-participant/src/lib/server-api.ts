import type { Event, EventSearchQuery } from "@teranga/shared-types";

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
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export const serverEventsApi = {
  search: (query: Partial<EventSearchQuery> = {}) =>
    serverFetch<PaginatedResponse<Event>>(`/v1/events${buildQuery(query)}`),

  getBySlug: (slug: string) =>
    serverFetch<ApiResponse<Event>>(`/v1/events/by-slug/${encodeURIComponent(slug)}`),

  getById: (id: string) =>
    serverFetch<ApiResponse<Event>>(`/v1/events/${id}`),
};

export type { ApiResponse, PaginatedResponse };
