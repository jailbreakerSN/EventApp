import { firebaseAuth } from "./firebase";
import type {
  Event,
  CreateEventDto,
  UpdateEventDto,
  CloneEventDto,
  Registration,
  EventSearchQuery,
  CreateTicketTypeDto,
  UpdateTicketTypeDto,
  CheckinStats,
  CheckinLogEntry,
  CheckinHistoryQuery,
  CreateAccessZoneDto,
  UpdateAccessZoneDto,
  Organization,
  UpdateOrganizationDto,
  OrganizationInvite,
  CreateInviteDto,
  OrgAnalytics,
  AnalyticsQuery,
  Session,
  CreateSessionDto,
  UpdateSessionDto,
  SessionScheduleQuery,
  SessionBookmark,
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
  PaymentSummary,
  PaymentQuery,
  Payout,
  PayoutQuery,
  Receipt,
  Broadcast,
  CreateBroadcastDto,
  BroadcastQuery,
  Notification,
  SpeakerProfile,
  CreateSpeakerDto,
  UpdateSpeakerDto,
  SponsorProfile,
  CreateSponsorDto,
  UpdateSponsorDto,
  SponsorLead,
  UserProfile,
  AuditLogEntry,
  PlatformStats,
  AdminUserQuery,
  AdminOrgQuery,
  AdminEventQuery,
  AdminAuditQuery,
  Venue,
  VenueQuery,
  CreateVenueDto,
  UpdateVenueDto,
  BadgeTemplate,
  CreateBadgeTemplateDto,
  UpdateBadgeTemplateDto,
  GeneratedBadge,
  UploadUrlResponse,
  Subscription,
  PlanUsage,
  Plan,
  CreatePlanDto,
  UpdatePlanDto,
  AssignPlanDto,
  PreviewChangeResponse,
  PlanAnalytics,
  BalanceTransaction,
  BalanceTransactionQuery,
  OrganizationBalance,
  AdminUserRow,
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
      throw new ApiError("TIMEOUT", "Request timed out", 408);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  // Token expired — force refresh and retry once
  if (response.status === 401 && !_isRetry && auth) {
    const user = firebaseAuth.currentUser;
    if (user) {
      await user.getIdToken(true); // force refresh
      return request<T>(path, options, auth, true);
    }
  }

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

  listByOrg: (
    orgId: string,
    params: {
      page?: number;
      limit?: number;
      orderBy?: string;
      orderDir?: string;
      category?: string;
      status?: string;
    } = {},
  ) =>
    api.get<PaginatedResponse<Event>>(`/v1/events/org/${orgId}${buildQuery(params)}`),

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

  clone: (id: string, dto: CloneEventDto) =>
    api.post<ApiResponse<Event>>(`/v1/events/${id}/clone`, dto),

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

  promote: (registrationId: string) =>
    api.patch<ApiResponse<Registration>>(`/v1/registrations/${registrationId}`, { status: "confirmed" }),
};

export const checkinApi = {
  getStats: (eventId: string) =>
    api.get<ApiResponse<CheckinStats>>(`/v1/events/${eventId}/checkin/stats`),

  getHistory: (eventId: string, params: Partial<CheckinHistoryQuery> = {}) =>
    api.get<PaginatedResponse<CheckinLogEntry>>(`/v1/events/${eventId}/checkin/history${buildQuery(params)}`),

  performCheckin: (qrCodeValue: string, accessZoneId?: string) =>
    api.post<ApiResponse<{
      valid: boolean;
      registrationId: string | null;
      participantName: string | null;
      ticketType: string | null;
      accessZone: string | null;
      alreadyCheckedIn: boolean;
      checkedInAt: string | null;
      reason: string | null;
    }>>("/v1/registrations/checkin", { qrCodeValue, accessZoneId }),
};

export const accessZonesApi = {
  add: (eventId: string, dto: CreateAccessZoneDto) =>
    api.post<ApiResponse<Event>>(`/v1/events/${eventId}/access-zones`, dto),

  update: (eventId: string, zoneId: string, dto: Partial<UpdateAccessZoneDto>) =>
    api.patch<ApiResponse<Event>>(`/v1/events/${eventId}/access-zones/${zoneId}`, dto),

  remove: (eventId: string, zoneId: string) =>
    api.delete(`/v1/events/${eventId}/access-zones/${zoneId}`),
};

export const organizationsApi = {
  getById: (id: string) =>
    api.get<ApiResponse<Organization>>(`/v1/organizations/${id}`),

  update: (id: string, dto: Partial<UpdateOrganizationDto>) =>
    api.patch<ApiResponse<{ id: string }>>(`/v1/organizations/${id}`, dto),

  addMember: (orgId: string, userId: string) =>
    api.post<ApiResponse<{ orgId: string; userId: string }>>(`/v1/organizations/${orgId}/members`, { userId }),

  removeMember: (orgId: string, userId: string) =>
    request(`/v1/organizations/${orgId}/members`, {
      method: "DELETE",
      body: JSON.stringify({ userId }),
    }),

  updateMemberRole: (orgId: string, userId: string, role: string) =>
    api.patch<ApiResponse<{ orgId: string; userId: string; role: string }>>(`/v1/organizations/${orgId}/members/${userId}/role`, { role }),

  getAnalytics: (orgId: string, query: Partial<AnalyticsQuery> = {}) =>
    api.get<ApiResponse<OrgAnalytics>>(`/v1/organizations/${orgId}/analytics${buildQuery(query)}`),

  getSubscription: (orgId: string) =>
    api.get<ApiResponse<Subscription | null>>(`/v1/organizations/${orgId}/subscription`),

  getUsage: (orgId: string) =>
    api.get<ApiResponse<PlanUsage>>(`/v1/organizations/${orgId}/usage`),

  upgradePlan: (orgId: string, plan: string, cycle?: "monthly" | "annual") =>
    api.post<ApiResponse<Subscription>>(
      `/v1/organizations/${orgId}/subscription/upgrade`,
      cycle ? { plan, cycle } : { plan },
    ),

  downgradePlan: (orgId: string, plan: string, options: { immediate?: boolean } = {}) =>
    api.post<ApiResponse<{ scheduled: boolean; effectiveAt?: string }>>(
      `/v1/organizations/${orgId}/subscription/downgrade`,
      { plan, immediate: options.immediate ?? false },
    ),

  cancelSubscription: (orgId: string, options: { immediate?: boolean; reason?: string } = {}) =>
    api.post<ApiResponse<{ scheduled: boolean; effectiveAt?: string }>>(
      `/v1/organizations/${orgId}/subscription/cancel`,
      { immediate: options.immediate ?? false, reason: options.reason },
    ),

  revertScheduledChange: (orgId: string) =>
    api.post<ApiResponse<null>>(
      `/v1/organizations/${orgId}/subscription/revert-scheduled`,
      {},
    ),
};

export const invitesApi = {
  list: (orgId: string) =>
    api.get<ApiResponse<OrganizationInvite[]>>(`/v1/organizations/${orgId}/invites`),

  create: (orgId: string, dto: CreateInviteDto) =>
    api.post<ApiResponse<OrganizationInvite>>(`/v1/organizations/${orgId}/invites`, dto),

  revoke: (orgId: string, inviteId: string) =>
    api.delete(`/v1/organizations/${orgId}/invites/${inviteId}`),

  accept: (token: string) =>
    api.post<ApiResponse<null>>("/v1/invites/accept", { token }),

  decline: (token: string) =>
    api.post<ApiResponse<null>>("/v1/invites/decline", { token }),
};

export const sessionsApi = {
  list: (eventId: string, query: Partial<SessionScheduleQuery> = {}) =>
    api.get<PaginatedResponse<Session>>(`/v1/events/${eventId}/sessions${buildQuery(query)}`),

  getById: (eventId: string, sessionId: string) =>
    api.get<ApiResponse<Session>>(`/v1/events/${eventId}/sessions/${sessionId}`),

  create: (eventId: string, dto: CreateSessionDto) =>
    api.post<ApiResponse<Session>>(`/v1/events/${eventId}/sessions`, dto),

  update: (eventId: string, sessionId: string, dto: Partial<UpdateSessionDto>) =>
    api.patch<ApiResponse<void>>(`/v1/events/${eventId}/sessions/${sessionId}`, dto),

  delete: (eventId: string, sessionId: string) =>
    api.delete(`/v1/events/${eventId}/sessions/${sessionId}`),

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

  togglePin: (eventId: string, postId: string) =>
    api.post<ApiResponse<{ pinned: boolean }>>(`/v1/events/${eventId}/feed/${postId}/pin`, {}),

  deletePost: (eventId: string, postId: string) =>
    api.delete(`/v1/events/${eventId}/feed/${postId}`),

  listComments: (eventId: string, postId: string, query: Partial<FeedQuery> = {}) =>
    api.get<PaginatedResponse<FeedComment>>(`/v1/events/${eventId}/feed/${postId}/comments${buildQuery(query)}`),

  addComment: (eventId: string, postId: string, dto: CreateFeedCommentDto) =>
    api.post<ApiResponse<FeedComment>>(`/v1/events/${eventId}/feed/${postId}/comments`, dto),

  deleteComment: (eventId: string, postId: string, commentId: string) =>
    api.delete(`/v1/events/${eventId}/feed/${postId}/comments/${commentId}`),
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

export const paymentsApi = {
  listByEvent: (eventId: string, query: Partial<PaymentQuery> = {}) =>
    api.get<PaginatedResponse<Payment>>(`/v1/payments/event/${eventId}${buildQuery(query)}`),

  getSummary: (eventId: string) =>
    api.get<ApiResponse<PaymentSummary>>(`/v1/payments/event/${eventId}/summary`),

  refund: (paymentId: string, body: { amount?: number; reason?: string } = {}) =>
    api.post<ApiResponse<Payment>>(`/v1/payments/${paymentId}/refund`, body),
};

export const balanceApi = {
  getSummary: (orgId: string) =>
    api.get<ApiResponse<OrganizationBalance>>(`/v1/organizations/${orgId}/balance`),

  listTransactions: (orgId: string, query: Partial<BalanceTransactionQuery> = {}) =>
    api.get<PaginatedResponse<BalanceTransaction>>(
      `/v1/organizations/${orgId}/balance-transactions${buildQuery(query)}`,
    ),
};

export const payoutsApi = {
  calculate: (eventId: string, periodFrom: string, periodTo: string) =>
    api.get<ApiResponse<{ totalAmount: number; platformFee: number; netAmount: number; paymentCount: number }>>(`/v1/payouts/event/${eventId}/calculate${buildQuery({ periodFrom, periodTo })}`),

  create: (eventId: string, body: { eventId: string; periodFrom: string; periodTo: string }) =>
    api.post<ApiResponse<Payout>>(`/v1/payouts/event/${eventId}`, body),

  listByOrg: (orgId: string, query: Partial<PayoutQuery> = {}) =>
    api.get<PaginatedResponse<Payout>>(`/v1/payouts/organization/${orgId}${buildQuery(query)}`),

  getById: (payoutId: string) =>
    api.get<ApiResponse<Payout>>(`/v1/payouts/${payoutId}`),
};

export const receiptsApi = {
  generate: (paymentId: string) =>
    api.post<ApiResponse<Receipt>>(`/v1/receipts/${paymentId}/generate`, {}),

  getById: (receiptId: string) =>
    api.get<ApiResponse<Receipt>>(`/v1/receipts/${receiptId}`),

  listMy: (params: { page?: number; limit?: number } = {}) =>
    api.get<PaginatedResponse<Receipt>>(`/v1/receipts/my${buildQuery(params)}`),
};

export const broadcastsApi = {
  send: (dto: CreateBroadcastDto) =>
    api.post<ApiResponse<Broadcast>>(`/v1/events/${dto.eventId}/broadcast`, dto),

  list: (eventId: string, query: Partial<BroadcastQuery> = {}) =>
    api.get<PaginatedResponse<Broadcast>>(`/v1/events/${eventId}/broadcasts${buildQuery(query)}`),
};

export const notificationsApi = {
  list: (params: { page?: number; limit?: number; unreadOnly?: boolean } = {}) =>
    api.get<{ success: boolean; data: Notification[]; meta: { total: number } }>(`/v1/notifications${buildQuery(params)}`),

  unreadCount: () =>
    api.get<ApiResponse<{ count: number }>>("/v1/notifications/unread-count"),

  markAsRead: (notificationId: string) =>
    api.patch<{ success: boolean }>(`/v1/notifications/${notificationId}/read`, {}),

  markAllAsRead: () =>
    api.patch<{ success: boolean }>("/v1/notifications/read-all", {}),
};

export const speakersApi = {
  list: (eventId: string, params: { page?: number; limit?: number } = {}) =>
    api.get<PaginatedResponse<SpeakerProfile>>(`/v1/events/${eventId}/speakers${buildQuery(params)}`),

  getById: (speakerId: string) =>
    api.get<ApiResponse<SpeakerProfile>>(`/v1/events/speakers/${speakerId}`),

  create: (eventId: string, dto: CreateSpeakerDto) =>
    api.post<ApiResponse<SpeakerProfile>>(`/v1/events/${eventId}/speakers`, dto),

  update: (speakerId: string, dto: Partial<UpdateSpeakerDto>) =>
    api.patch<ApiResponse<SpeakerProfile>>(`/v1/events/speakers/${speakerId}`, dto),

  remove: (speakerId: string) =>
    api.delete(`/v1/events/speakers/${speakerId}`),
};

export const sponsorsApi = {
  list: (eventId: string, params: { page?: number; limit?: number; tier?: string } = {}) =>
    api.get<PaginatedResponse<SponsorProfile>>(`/v1/events/${eventId}/sponsors${buildQuery(params)}`),

  getById: (sponsorId: string) =>
    api.get<ApiResponse<SponsorProfile>>(`/v1/events/sponsors/${sponsorId}`),

  create: (eventId: string, dto: CreateSponsorDto) =>
    api.post<ApiResponse<SponsorProfile>>(`/v1/events/${eventId}/sponsors`, dto),

  update: (sponsorId: string, dto: Partial<UpdateSponsorDto>) =>
    api.patch<ApiResponse<SponsorProfile>>(`/v1/events/sponsors/${sponsorId}`, dto),

  remove: (sponsorId: string) =>
    api.delete(`/v1/events/sponsors/${sponsorId}`),

  listLeads: (sponsorId: string, params: { page?: number; limit?: number } = {}) =>
    api.get<PaginatedResponse<SponsorLead>>(`/v1/events/sponsors/${sponsorId}/leads${buildQuery(params)}`),

  exportLeads: (sponsorId: string) =>
    api.get<ApiResponse<SponsorLead[]>>(`/v1/events/sponsors/${sponsorId}/leads/export`),
};

// ─── Admin ──────────────────────────────────────────────────────────────────

export const adminApi = {
  getStats: () =>
    api.get<ApiResponse<PlatformStats>>("/v1/admin/stats"),

  listUsers: (query: Partial<AdminUserQuery> = {}) =>
    api.get<PaginatedResponse<AdminUserRow>>(`/v1/admin/users${buildQuery(query)}`),

  updateUserRoles: (userId: string, roles: string[]) =>
    api.patch<void>(`/v1/admin/users/${userId}/roles`, { roles }),

  updateUserStatus: (userId: string, isActive: boolean) =>
    api.patch<void>(`/v1/admin/users/${userId}/status`, { isActive }),

  listOrganizations: (query: Partial<AdminOrgQuery> = {}) =>
    api.get<PaginatedResponse<Organization>>(`/v1/admin/organizations${buildQuery(query)}`),

  verifyOrganization: (orgId: string) =>
    api.patch<void>(`/v1/admin/organizations/${orgId}/verify`, {}),

  updateOrgStatus: (orgId: string, isActive: boolean) =>
    api.patch<void>(`/v1/admin/organizations/${orgId}/status`, { isActive }),

  listEvents: (query: Partial<AdminEventQuery> = {}) =>
    api.get<PaginatedResponse<Event>>(`/v1/admin/events${buildQuery(query)}`),

  listAuditLogs: (query: Partial<AdminAuditQuery> = {}) =>
    api.get<PaginatedResponse<AuditLogEntry>>(`/v1/admin/audit-logs${buildQuery(query)}`),

  // ── Plan Catalog ────────────────────────────────────────────────────────
  listPlans: (query: { includeArchived?: boolean } = {}) =>
    api.get<ApiResponse<Plan[]>>(`/v1/admin/plans${buildQuery(query)}`),

  getPlan: (planId: string) =>
    api.get<ApiResponse<Plan>>(`/v1/admin/plans/${planId}`),

  createPlan: (dto: CreatePlanDto) =>
    api.post<ApiResponse<Plan>>("/v1/admin/plans", dto),

  updatePlan: (planId: string, dto: UpdatePlanDto) =>
    api.patch<ApiResponse<Plan>>(`/v1/admin/plans/${planId}`, dto),

  archivePlan: (planId: string) => api.delete(`/v1/admin/plans/${planId}`),

  // Phase 7+ item #5: MRR / cohort dashboard snapshot.
  getPlanAnalytics: () =>
    api.get<ApiResponse<PlanAnalytics>>("/v1/admin/plans/analytics"),

  // Phase 7+ item #6: dry-run / impact preview. POST because the body is
  // a proposed UpdatePlanDto the admin hasn't saved yet — no mutation.
  previewPlanChange: (planId: string, dto: UpdatePlanDto) =>
    api.post<ApiResponse<PreviewChangeResponse>>(
      `/v1/admin/plans/${planId}/preview-change`,
      dto,
    ),

  // ── Per-org plan assignment (Phase 5: admin override) ──────────────────
  assignPlan: (orgId: string, dto: AssignPlanDto) =>
    api.post<ApiResponse<Subscription>>(
      `/v1/admin/organizations/${orgId}/subscription/assign`,
      dto,
    ),

  getOrgSubscription: (orgId: string) =>
    api.get<ApiResponse<Subscription | null>>(`/v1/organizations/${orgId}/subscription`),
};

// ─── Public Plan Catalog (Phase 6) ──────────────────────────────────────────
// The superadmin-managed Plans collection, exposed to any authenticated user
// as a read-only list. Used by billing / upgrade / plan-gating UIs instead of
// the hardcoded PLAN_DISPLAY constant so custom superadmin-created plans
// render correctly.

export const plansApi = {
  listPublic: () => api.get<ApiResponse<Plan[]>>("/v1/plans"),
  getByKey: (key: string) => api.get<ApiResponse<Plan>>(`/v1/plans/${key}`),
};

// ─── Venues ─────────────────────────────────────────────────────────────────

export const venuesApi = {
  listPublic: (query: Partial<VenueQuery> = {}) =>
    api.get<PaginatedResponse<Venue>>(`/v1/venues${buildQuery(query)}`),

  getById: (id: string) =>
    api.get<ApiResponse<Venue>>(`/v1/venues/${id}`),

  create: (dto: CreateVenueDto) =>
    api.post<ApiResponse<Venue>>("/v1/venues", dto),

  update: (id: string, dto: Partial<UpdateVenueDto>) =>
    api.patch<ApiResponse<Venue>>(`/v1/venues/${id}`, dto),

  approve: (venueId: string) =>
    api.post<void>(`/v1/venues/${venueId}/approve`, {}),

  suspend: (venueId: string) =>
    api.post<void>(`/v1/venues/${venueId}/suspend`, {}),

  reactivate: (venueId: string) =>
    api.post<void>(`/v1/venues/${venueId}/reactivate`, {}),

  getEvents: (venueId: string, params: { page?: number; limit?: number } = {}) =>
    api.get<PaginatedResponse<Event>>(`/v1/venues/${venueId}/events${buildQuery(params)}`),

  listMyVenues: () =>
    api.get<PaginatedResponse<Venue>>("/v1/venues/mine"),
};

// ─── Badge Templates ───────────────────────────────────────────────────────

export const badgeTemplatesApi = {
  list: (organizationId: string, params: { page?: number; limit?: number } = {}) =>
    api.get<PaginatedResponse<BadgeTemplate>>(`/v1/badge-templates${buildQuery({ organizationId, ...params })}`),

  getById: (templateId: string) =>
    api.get<ApiResponse<BadgeTemplate>>(`/v1/badge-templates/${templateId}`),

  create: (dto: CreateBadgeTemplateDto) =>
    api.post<ApiResponse<BadgeTemplate>>("/v1/badge-templates", dto),

  update: (templateId: string, dto: Partial<UpdateBadgeTemplateDto>) =>
    api.patch<ApiResponse<{ id: string }>>(`/v1/badge-templates/${templateId}`, dto),

  remove: (templateId: string) =>
    api.delete(`/v1/badge-templates/${templateId}`),
};

// ─── Badges ────────────────────────────────────────────────────────────────

export const badgesApi = {
  generate: (registrationId: string, templateId: string) =>
    api.post<ApiResponse<GeneratedBadge>>("/v1/badges/generate", { registrationId, templateId }),

  bulkGenerate: (eventId: string, templateId: string) =>
    api.post<ApiResponse<{ queued: number }>>("/v1/badges/bulk-generate", { eventId, templateId }),

  download: (badgeId: string) =>
    api.get<ApiResponse<{ downloadUrl: string }>>(`/v1/badges/${badgeId}/download`),
};

// ─── Uploads ──────────────────────────────────────────────────────────────

export const uploadsApi = {
  getEventSignedUrl: (
    eventId: string,
    body: { fileName: string; contentType: string; purpose: string },
  ) =>
    api.post<ApiResponse<UploadUrlResponse>>(`/v1/events/${eventId}/upload-url`, body),
};

export { ApiError };
export type { ApiResponse, PaginatedResponse };
