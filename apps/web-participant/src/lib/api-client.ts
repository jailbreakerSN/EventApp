import { firebaseAuth } from "./firebase";
import type {
  Event,
  Registration,
  EventSearchQuery,
  GeneratedBadge,
  Session,
  SessionBookmark,
  SessionScheduleQuery,
  FeedPost,
  FeedComment,
  CreateFeedPostDto,
  CreateFeedCommentDto,
  FeedQuery,
  Conversation,
  Message,
  CreateConversationDto,
  SendMessageDto,
  MessageQuery,
} from "@teranga/shared-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getAuthHeader(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new ApiError("UNAUTHORIZED", "Non authentifié", 401);
  const token = await user.getIdToken();
  return `Bearer ${token}`;
}

const REQUEST_TIMEOUT_MS = 30_000;

async function request<T>(
  path: string,
  options: RequestInit = {},
  auth = true,
  _isRetry = false,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (auth) {
    headers.Authorization = await getAuthHeader();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("TIMEOUT", "La requête a expiré", 408);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 && !_isRetry && auth) {
    const user = firebaseAuth.currentUser;
    if (user) {
      await user.getIdToken(true);
      return request<T>(path, options, auth, true);
    }
  }

  if (response.status === 204) {
    return {} as T;
  }

  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new ApiError(
      data.error?.code ?? "UNKNOWN",
      data.error?.message ?? "La requête a échoué",
      response.status,
    );
  }

  return data as T;
}

const api = {
  get: <T>(path: string, auth = true) => request<T>(path, {}, auth),
  post: <T>(path: string, body: unknown, auth = true) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }, auth),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    request<T>(path, { method: "DELETE" }),
};

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

export const eventsApi = {
  search: (query: Partial<EventSearchQuery> = {}) =>
    api.get<PaginatedResponse<Event>>(`/v1/events${buildQuery(query)}`, false),

  getById: (id: string) =>
    api.get<ApiResponse<Event>>(`/v1/events/${id}`, false),

  getBySlug: (slug: string) =>
    api.get<ApiResponse<Event>>(`/v1/events/by-slug/${encodeURIComponent(slug)}`, false),
};

export const registrationsApi = {
  register: (eventId: string, ticketTypeId: string) =>
    api.post<ApiResponse<Registration>>("/v1/registrations", { eventId, ticketTypeId }),

  getMyRegistrations: (params: { page?: number; limit?: number } = {}) =>
    api.get<PaginatedResponse<Registration>>(`/v1/registrations/me${buildQuery(params)}`),

  cancel: (registrationId: string) =>
    api.post<ApiResponse<void>>(`/v1/registrations/${registrationId}/cancel`, {}),
};

export const badgesApi = {
  getMyBadge: (eventId: string) =>
    api.get<ApiResponse<GeneratedBadge>>(`/v1/badges/me/${eventId}`),

  getDownloadUrl: (badgeId: string) =>
    api.get<ApiResponse<{ url: string }>>(`/v1/badges/${badgeId}/download`),
};

export const usersApi = {
  getMe: () => api.get<ApiResponse<{ uid: string; email: string; displayName: string | null; phone: string | null; bio: string | null; photoURL: string | null; preferredLanguage: string }>>("/v1/users/me"),

  updateMe: (data: { displayName?: string; phone?: string; bio?: string; preferredLanguage?: string }) =>
    api.patch<ApiResponse<void>>("/v1/users/me", data),
};

export const sessionsApi = {
  list: (eventId: string, query: Partial<SessionScheduleQuery> = {}) =>
    api.get<PaginatedResponse<Session>>(`/v1/events/${eventId}/sessions${buildQuery(query)}`),

  getById: (eventId: string, sessionId: string) =>
    api.get<ApiResponse<Session>>(`/v1/events/${eventId}/sessions/${sessionId}`),

  bookmark: (eventId: string, sessionId: string) =>
    api.post<ApiResponse<SessionBookmark>>(`/v1/events/${eventId}/sessions/${sessionId}/bookmark`, {}),

  removeBookmark: (eventId: string, sessionId: string) =>
    api.delete(`/v1/events/${eventId}/sessions/${sessionId}/bookmark`),

  getBookmarks: (eventId: string) =>
    api.get<ApiResponse<SessionBookmark[]>>(`/v1/events/${eventId}/sessions-bookmarks`),
};

export const feedApi = {
  list: (eventId: string, query: Partial<FeedQuery> = {}) =>
    api.get<PaginatedResponse<FeedPost>>(`/v1/events/${eventId}/feed${buildQuery(query)}`),

  create: (eventId: string, dto: CreateFeedPostDto) =>
    api.post<ApiResponse<FeedPost>>(`/v1/events/${eventId}/feed`, dto),

  toggleLike: (eventId: string, postId: string) =>
    api.post<ApiResponse<{ liked: boolean }>>(`/v1/events/${eventId}/feed/${postId}/like`, {}),

  listComments: (eventId: string, postId: string, query: Partial<FeedQuery> = {}) =>
    api.get<PaginatedResponse<FeedComment>>(`/v1/events/${eventId}/feed/${postId}/comments${buildQuery(query)}`),

  addComment: (eventId: string, postId: string, dto: CreateFeedCommentDto) =>
    api.post<ApiResponse<FeedComment>>(`/v1/events/${eventId}/feed/${postId}/comments`, dto),
};

export const messagingApi = {
  listConversations: (query: Partial<MessageQuery> = {}) =>
    api.get<PaginatedResponse<Conversation>>(`/v1/conversations${buildQuery(query)}`),

  getOrCreate: (dto: CreateConversationDto) =>
    api.post<ApiResponse<Conversation>>("/v1/conversations", dto),

  listMessages: (conversationId: string, query: Partial<MessageQuery> = {}) =>
    api.get<PaginatedResponse<Message>>(`/v1/conversations/${conversationId}/messages${buildQuery(query)}`),

  sendMessage: (conversationId: string, dto: SendMessageDto) =>
    api.post<ApiResponse<Message>>(`/v1/conversations/${conversationId}/messages`, dto),

  markAsRead: (conversationId: string) =>
    api.post<ApiResponse<void>>(`/v1/conversations/${conversationId}/read`, {}),
};

export { api, ApiError };
export type { ApiResponse, PaginatedResponse };
