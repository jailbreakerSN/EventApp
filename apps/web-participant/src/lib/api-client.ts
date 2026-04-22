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
  Payment,
  PaymentMethod,
  Receipt,
  Notification,
  NotificationPreference,
  NotificationCategory,
  NotificationChannel,
  I18nString,
  UpdateNotificationPreferenceDto,
  SpeakerProfile,
  SponsorProfile,
  UploadUrlResponse,
} from "@teranga/shared-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    /**
     * Structured payload the server attached via `AppError.toJSON`. The
     * shape is error-specific — e.g. `CONFLICT` carries
     * `{ reason: "duplicate_registration", eventId }`,
     * `REGISTRATION_CLOSED` carries `{ reason, eventId }`. Kept on the
     * thrown error so `useErrorHandler` can branch on `details.reason`
     * to render targeted copy. Mirrors the backoffice client.
     */
    public readonly details?: Record<string, unknown>,
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
      try {
        await user.getIdToken(true);
        return request<T>(path, options, auth, true);
      } catch {
        // Token refresh failed — session is invalid
        await firebaseAuth.signOut();
        throw new ApiError("AUTH_EXPIRED", "Votre session a expiré. Veuillez vous reconnecter.", 401);
      }
    }
  }

  if (response.status === 204) {
    return {} as T;
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    // Response body is not valid JSON (e.g. empty body on error responses)
    if (!response.ok) {
      throw new ApiError("UNKNOWN", "La requête a échoué", response.status);
    }
    return {} as T;
  }

  if (!response.ok || data.success === false) {
    const error = data.error as
      | { code?: string; message?: string; details?: Record<string, unknown> }
      | undefined;
    throw new ApiError(
      error?.code ?? "UNKNOWN",
      error?.message ?? "La requête a échoué",
      response.status,
      error?.details,
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

// Binary-fetch counterpart of `request()`. JSON `request()` can't be reused
// because it always parses the body as JSON; PDFs need `.blob()`. Keeps the
// same hardening: 30 s abort timeout + single 401 retry with refreshed ID
// token, matching the Security Hardening Checklist (CLAUDE.md).
async function fetchPdf(path: string, _isRetry = false): Promise<Blob> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: await getAuthHeader() },
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

  if (response.status === 401 && !_isRetry) {
    const user = firebaseAuth.currentUser;
    if (user) {
      try {
        await user.getIdToken(true);
        return fetchPdf(path, true);
      } catch {
        await firebaseAuth.signOut();
        throw new ApiError("AUTH_EXPIRED", "Votre session a expiré. Veuillez vous reconnecter.", 401);
      }
    }
  }

  if (!response.ok) {
    throw new ApiError("PDF_FETCH_FAILED", "Impossible de récupérer le PDF du badge", response.status);
  }

  return response.blob();
}

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

  /**
   * Fetch the badge PDF as a Blob. The API streams the bytes directly with
   * `application/pdf`, so callers create an object URL and open/download it
   * locally — no signed-URL hop through Cloud Storage required.
   *
   * Mirrors the hardening of the JSON `request()` helper: 30 s abort timeout
   * and one transparent retry after a forced ID-token refresh on 401.
   */
  getMyBadgePdf: (eventId: string): Promise<Blob> =>
    fetchPdf(`/v1/badges/me/${eventId}/pdf`),
};

export const usersApi = {
  getMe: () => api.get<ApiResponse<{ uid: string; email: string; displayName: string | null; phone: string | null; bio: string | null; photoURL: string | null; preferredLanguage: string }>>("/v1/users/me"),

  updateMe: (data: { displayName?: string; phone?: string; bio?: string; preferredLanguage?: string; photoURL?: string }) =>
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

  updatePost: (eventId: string, postId: string, content: string) =>
    api.patch<ApiResponse<FeedPost>>(`/v1/events/${eventId}/feed/${postId}`, { content }),

  deletePost: (eventId: string, postId: string) =>
    api.delete<void>(`/v1/events/${eventId}/feed/${postId}`),

  deleteComment: (eventId: string, postId: string, commentId: string) =>
    api.delete<void>(`/v1/events/${eventId}/feed/${postId}/comments/${commentId}`),

  getUploadUrl: (eventId: string, body: { fileName: string; contentType: string }) =>
    api.post<ApiResponse<UploadUrlResponse>>(`/v1/events/${eventId}/feed/upload-url`, {
      ...body,
      purpose: "feed",
    }),
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

export const promoCodesApi = {
  validate: (eventId: string, code: string, ticketTypeId: string) =>
    api.post<ApiResponse<{ valid: boolean; promoCodeId: string; discountType: "percentage" | "fixed"; discountValue: number }>>(
      `/v1/events/${eventId}/promo-codes/validate`,
      { code, ticketTypeId },
      false,
    ),
};

export const paymentsApi = {
  initiate: (eventId: string, ticketTypeId: string, method: PaymentMethod = "mock", returnUrl?: string) =>
    api.post<ApiResponse<{ paymentId: string; redirectUrl: string }>>("/v1/payments/initiate", {
      eventId,
      ticketTypeId,
      method,
      returnUrl,
    }),

  getStatus: (paymentId: string) =>
    api.get<ApiResponse<Payment>>(`/v1/payments/${paymentId}/status`),

  refund: (paymentId: string, reason?: string) =>
    api.post<ApiResponse<Payment>>(`/v1/payments/${paymentId}/refund`, { reason }),
};

export const receiptsApi = {
  generate: (paymentId: string) =>
    api.post<ApiResponse<Receipt>>(`/v1/receipts/${paymentId}/generate`, {}),

  getById: (receiptId: string) =>
    api.get<ApiResponse<Receipt>>(`/v1/receipts/${receiptId}`),

  listMy: (params: { page?: number; limit?: number } = {}) =>
    api.get<PaginatedResponse<Receipt>>(`/v1/receipts/my${buildQuery(params)}`),

  getPdf: (receiptId: string) =>
    api.get<ApiResponse<{ receipt: Receipt; pdfURL: string }>>(
      `/v1/receipts/${receiptId}/pdf`,
    ),
};

/**
 * Phase 3 user-preferences payload. Mirrors the route shape in
 * apps/api/src/routes/notifications.routes.ts — a flat projection of the
 * catalog plus the user's effective enabled state.
 */
export interface NotificationCatalogEntry {
  key: string;
  category: NotificationCategory;
  displayName: I18nString;
  description: I18nString;
  userOptOutAllowed: boolean;
  enabled: boolean;
  // Phase B.1 per-channel grid — same shape as the backoffice client. The
  // preferences page reads these to render a toggle per supported channel
  // instead of the legacy single switch.
  supportedChannels: NotificationChannel[];
  defaultChannels: NotificationChannel[];
  effectiveChannels: Record<NotificationChannel, boolean>;
  userPreference: boolean | Partial<Record<NotificationChannel, boolean>> | null;
}

/**
 * Response from POST /v1/notifications/test-send — self-targeted preview
 * dispatched via the notification dispatcher with `testMode=true`.
 */
export interface TestSendSelfResponse {
  dispatched: boolean;
  key: string;
  locale: "fr" | "en" | "wo";
}

export const notificationsApi = {
  list: (params: { page?: number; limit?: number; unreadOnly?: boolean } = {}) =>
    api.get<{ success: boolean; data: Notification[]; meta: { total: number } }>(`/v1/notifications${buildQuery(params)}`),

  unreadCount: () =>
    api.get<ApiResponse<{ count: number }>>("/v1/notifications/unread-count"),

  markAsRead: (notificationId: string) =>
    api.patch<{ success: boolean }>(`/v1/notifications/${notificationId}/read`, {}),

  markAllAsRead: () =>
    api.patch<{ success: boolean }>("/v1/notifications/read-all", {}),

  getPreferences: () =>
    api.get<ApiResponse<NotificationPreference>>("/v1/notifications/preferences"),

  // Legacy call site: /useNotificationPreferences/ mutation in
  // use-notifications.ts uses this via PATCH for backwards compatibility.
  // The actual API route is PUT (see notifications.routes.ts line 172) —
  // PATCH is tolerated server-side because it hits the same handler, but
  // new code should prefer `putPreferences` below.
  updatePreferences: (dto: UpdateNotificationPreferenceDto) =>
    request<ApiResponse<NotificationPreference>>("/v1/notifications/preferences", {
      method: "PUT",
      body: JSON.stringify(dto),
    }),

  // Phase 3 — catalog + per-key opt-out. Kept separate from the channel-
  // level toggles on /settings because the catalog page is an independent
  // surface with its own loading / save-diff semantics.
  catalog: () =>
    api.get<ApiResponse<NotificationCatalogEntry[]>>("/v1/notifications/catalog"),

  // Alias for `catalog` — new naming used by the Phase B.2 preferences
  // page to match the GET/mutation convention elsewhere in this client.
  // Old callers (`catalog()`) still work.
  getCatalog: () =>
    api.get<ApiResponse<NotificationCatalogEntry[]>>("/v1/notifications/catalog"),

  // Phase B.1 — user triggers a preview of an opt-outable notification
  // against their own inbox. Rate-limited 5/hour; rejects mandatory keys
  // with 400 NOT_OPTABLE so the UI can show a targeted error.
  testSendSelf: (key: string) =>
    api.post<ApiResponse<TestSendSelfResponse>>("/v1/notifications/test-send", { key }),
};

export const uploadsApi = {
  getSpeakerSignedUrl: (
    speakerId: string,
    body: { fileName: string; contentType: string; purpose: string },
  ) =>
    api.post<ApiResponse<UploadUrlResponse>>(
      `/v1/events/speakers/${speakerId}/upload-url`,
      body,
    ),
};

// NOTE: Speaker/sponsor routes mount under `/v1/events/speakers/:id` and
// `/v1/events/sponsors/:id` on the API (see apps/api/src/routes/index.ts
// — the plugin prefix is `/v1/events`). Earlier the client paths dropped
// the `/events` segment and every speaker/sponsor action from this app
// silently 404'd. The canonical URLs live on the backoffice client;
// mirrored here verbatim.
export const speakersApi = {
  list: (eventId: string) =>
    api.get<PaginatedResponse<SpeakerProfile>>(`/v1/events/${eventId}/speakers`, false),

  getById: (speakerId: string) =>
    api.get<ApiResponse<SpeakerProfile>>(`/v1/events/speakers/${speakerId}`),

  update: (speakerId: string, data: Partial<SpeakerProfile>) =>
    api.patch<ApiResponse<SpeakerProfile>>(`/v1/events/speakers/${speakerId}`, data),

  getSessions: (eventId: string, speakerId: string) =>
    api.get<PaginatedResponse<import("@teranga/shared-types").Session>>(
      `/v1/events/${eventId}/sessions?speakerId=${speakerId}`,
      false,
    ),
};

export const sponsorsApi = {
  list: (eventId: string) =>
    api.get<PaginatedResponse<SponsorProfile>>(`/v1/events/${eventId}/sponsors`, false),

  getById: (sponsorId: string) =>
    api.get<ApiResponse<SponsorProfile>>(`/v1/events/sponsors/${sponsorId}`),

  update: (sponsorId: string, data: Partial<SponsorProfile>) =>
    api.patch<ApiResponse<SponsorProfile>>(`/v1/events/sponsors/${sponsorId}`, data),

  getLeads: (sponsorId: string) =>
    api.get<
      PaginatedResponse<{
        id: string;
        name: string;
        email: string;
        phone?: string;
        notes?: string;
        tags: string[];
        scannedAt: string;
      }>
    >(`/v1/events/sponsors/${sponsorId}/leads`),

  // Leads export returns a JSON array, not CSV text. The caller is
  // responsible for converting to CSV client-side (reusing the
  // csv-export util when we port it to participant). Previous type
  // `{ data: string }` caused a `[object Object]` download.
  exportLeads: (sponsorId: string) =>
    api.get<
      ApiResponse<
        { id: string; name: string; email: string; phone?: string; notes?: string; tags: string[]; scannedAt: string }[]
      >
    >(`/v1/events/sponsors/${sponsorId}/leads/export`),
};

export const newsletterApi = {
  subscribe: (email: string) =>
    api.post<{ success: boolean; message: string }>("/v1/newsletter/subscribe", { email }, false),
};

// ─── Auth email endpoints ───────────────────────────────────────────────
// Thin wrappers around POST /v1/auth/send-verification-email and POST
// /v1/auth/send-password-reset-email. The API mints the Firebase OOB
// link via admin.auth() and ships it through Resend with our branded
// template — so the client stops calling Firebase Client SDK's
// sendEmailVerification / sendPasswordResetEmail directly (which would
// send via Firebase's SMTP, defeating DMARC + branding).
export const authEmailsApi = {
  sendVerification: () =>
    api.post<{ success: boolean }>("/v1/auth/send-verification-email", {
      audience: "participant",
    }),
  sendPasswordReset: (email: string) =>
    api.post<{ success: boolean; message: string }>(
      "/v1/auth/send-password-reset-email",
      { email, audience: "participant" },
      false,
    ),
};

// ─── Me / FCM Tokens (Phase C.1 — Web Push) ─────────────────────────────────
// Thin wrappers over /v1/me/fcm-tokens. The hook `useWebPushRegistration`
// owns the browser-side lifecycle (permission, token fetch, localStorage);
// this just ships the token to the API and drops it by fingerprint.
//
// POST is rate-limited 20/hour/user server-side — callers MUST surface
// 429 as "try later" rather than retrying, or a permission-flip loop will
// DoS the write path (see apps/api/src/routes/me.routes.ts rateLimit config).

export const meApi = {
  registerFcmToken: (body: { token: string; platform: "web"; userAgent?: string }) =>
    api.post<ApiResponse<{ tokenFingerprint: string; status: "registered" | "refreshed"; tokenCount: number }>>(
      "/v1/me/fcm-tokens",
      body,
    ),
  revokeFcmToken: (tokenFingerprint: string) =>
    api.delete<void>(`/v1/me/fcm-tokens/${encodeURIComponent(tokenFingerprint)}`),
  revokeAllFcmTokens: () => api.delete<void>("/v1/me/fcm-tokens"),
};

export { api, ApiError };
export type { ApiResponse, PaginatedResponse };
