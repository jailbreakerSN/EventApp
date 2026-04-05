import { firebaseAuth } from "./firebase";
import type {
  Event,
  CreateEventDto,
  UpdateEventDto,
  Registration,
  EventSearchQuery,
  CreateTicketTypeDto,
  UpdateTicketTypeDto,
} from "@teranga/shared-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// ─── Error ────────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Core request helpers ─────────────────────────────────────────────────────

async function getAuthHeader(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new ApiError("UNAUTHORIZED", "Not authenticated", 401);
  const token = await user.getIdToken();
  return `Bearer ${token}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  auth = true
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (auth) {
    headers.Authorization = await getAuthHeader();
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  // DELETE 204 has no body
  if (response.status === 204) {
    return {} as T;
  }

  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new ApiError(
      data.error?.code ?? "UNKNOWN",
      data.error?.message ?? "Request failed",
      response.status
    );
  }

  return data as T;
}

// ─── Generic methods ──────────────────────────────────────────────────────────

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, {}, auth),
  post: <T>(path: string, body: unknown, auth = true) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }, auth),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    request<T>(path, { method: "DELETE" }),
};

// ─── Response types ───────────────────────────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

// ─── Typed endpoint methods ───────────────────────────────────────────────────

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
}

export const eventsApi = {
  search: (query: Partial<EventSearchQuery> = {}) =>
    api.get<PaginatedResponse<Event>>(`/v1/events${buildQuery(query)}`),

  getById: (id: string) =>
    api.get<ApiResponse<Event>>(`/v1/events/${id}`),

  create: (dto: CreateEventDto) =>
    api.post<ApiResponse<Event>>("/v1/events", dto),

  update: (id: string, dto: Partial<UpdateEventDto>) =>
    api.patch<ApiResponse<Event>>(`/v1/events/${id}`, dto),

  publish: (id: string) =>
    api.post<ApiResponse<{ id: string; status: string }>>(`/v1/events/${id}/publish`, {}),

  unpublish: (id: string) =>
    api.post<ApiResponse<{ id: string; status: string }>>(`/v1/events/${id}/unpublish`, {}),

  cancel: (id: string) =>
    api.post<ApiResponse<{ id: string; status: string }>>(`/v1/events/${id}/cancel`, {}),

  archive: (id: string) =>
    api.delete(`/v1/events/${id}`),

  addTicketType: (eventId: string, dto: CreateTicketTypeDto) =>
    api.post<ApiResponse<Event>>(`/v1/events/${eventId}/ticket-types`, dto),

  updateTicketType: (eventId: string, ticketTypeId: string, dto: Partial<UpdateTicketTypeDto>) =>
    api.patch<ApiResponse<Event>>(`/v1/events/${eventId}/ticket-types/${ticketTypeId}`, dto),

  removeTicketType: (eventId: string, ticketTypeId: string) =>
    api.delete(`/v1/events/${eventId}/ticket-types/${ticketTypeId}`),
};

export const registrationsApi = {
  getEventRegistrations: (eventId: string, params: { page?: number; limit?: number; status?: string } = {}) =>
    api.get<PaginatedResponse<Registration>>(`/v1/registrations/event/${eventId}${buildQuery(params)}`),

  approve: (registrationId: string) =>
    api.post<ApiResponse<void>>(`/v1/registrations/${registrationId}/approve`, {}),

  cancel: (registrationId: string) =>
    api.post<ApiResponse<void>>(`/v1/registrations/${registrationId}/cancel`, {}),
};

export { ApiError };
export type { ApiResponse, PaginatedResponse };
