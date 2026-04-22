import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventBus } from "../event-bus";

// ─── Phase 2.3 dispatcher-listener tests ───────────────────────────────────
// Asserts that emitting each new Phase 2.3 domain event results in a
// single `notificationDispatcher.dispatch()` call with the expected key,
// recipients, and idempotency key. Upstream side effects (Firestore
// reads) are stubbed at the repository boundary.

const mockDispatch = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/notification-dispatcher.service", () => ({
  notificationDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
  },
}));

const mockUserFindById = vi.fn();
vi.mock("@/repositories/user.repository", () => ({
  userRepository: {
    findById: (...args: unknown[]) => mockUserFindById(...args),
  },
}));

const mockEventFindById = vi.fn();
vi.mock("@/repositories/event.repository", () => ({
  eventRepository: {
    findById: (...args: unknown[]) => mockEventFindById(...args),
  },
}));

const mockOrganizationFindById = vi.fn();
vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: {
    findById: (...args: unknown[]) => mockOrganizationFindById(...args),
  },
}));

// The event bus wraps emit in `setImmediate`, then async listeners
// perform multiple awaits (repo fetches, nested dispatch import). Flush
// a few times so every microtask queue drains.
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

const baseEventPayload = {
  actorId: "admin-1",
  requestId: "req-1",
  timestamp: "2026-04-22T09:00:00.000Z",
};

const baseUser = {
  uid: "u-1",
  email: "user@test.com",
  displayName: "Test User",
  preferredLanguage: "fr",
};

const baseEvent = {
  id: "ev-1",
  title: "Dakar Summit",
  slug: "dakar-summit",
  startDate: "2026-05-01T10:00:00.000Z",
  endDate: "2026-05-01T18:00:00.000Z",
  location: "Plateau, Dakar",
};

const baseOrg = {
  id: "org-1",
  name: "Teranga Events SRL",
  ownerId: "u-owner",
  memberIds: [] as string[],
};

beforeEach(async () => {
  vi.clearAllMocks();
  eventBus.removeAllListeners();
  mockUserFindById.mockResolvedValue(baseUser);
  mockEventFindById.mockResolvedValue(baseEvent);
  mockOrganizationFindById.mockResolvedValue(baseOrg);
  const mod = await import("../listeners/notification-dispatcher.listener");
  mod.registerNotificationDispatcherListeners();
});

describe("Phase 2.3 dispatcher listeners", () => {
  it("event.feedback_requested → dispatches event.feedback_requested", async () => {
    eventBus.emit("event.feedback_requested", {
      ...baseEventPayload,
      eventId: "ev-1",
      organizationId: "org-1",
      userId: "u-1",
      feedbackDeadline: "29 avril 2026",
    });
    await flushAsync();
    await flushAsync();

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const call = mockDispatch.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.key).toBe("event.feedback_requested");
    expect(call.idempotencyKey).toBe("event-feedback/ev-1/u-1");
    const params = call.params as Record<string, unknown>;
    expect(params.eventTitle).toBe("Dakar Summit");
    expect(params.feedbackDeadline).toBe("29 avril 2026");
    expect(params.feedbackUrl).toContain("dakar-summit");
  });

  it("event.certificates_issued → fans out one dispatch per user id", async () => {
    mockUserFindById.mockImplementation(async (uid: string) => ({
      ...baseUser,
      uid,
      email: `${uid}@test.com`,
    }));

    eventBus.emit("event.certificates_issued", {
      ...baseEventPayload,
      eventId: "ev-1",
      organizationId: "org-1",
      userIds: ["u-a", "u-b", "u-c"],
      validityHint: "30 jours",
    });
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(mockDispatch).toHaveBeenCalledTimes(3);
    const keys = mockDispatch.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(new Set(keys)).toEqual(new Set(["certificate.ready"]));
    const idempotency = mockDispatch.mock.calls.map(
      (c) => (c[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(idempotency).toContain("certificate-ready/ev-1/u-a");
    expect(idempotency).toContain("certificate-ready/ev-1/u-b");
    expect(idempotency).toContain("certificate-ready/ev-1/u-c");
  });

  it("subscription.expiring_soon → dispatches with per-renewal-date idempotency", async () => {
    eventBus.emit("subscription.expiring_soon", {
      ...baseEventPayload,
      organizationId: "org-1",
      planKey: "pro",
      amount: "29 900 FCFA",
      renewalAt: "2026-04-29T00:00:00.000Z",
      daysUntilRenewal: 7,
    });
    await flushAsync();
    await flushAsync();

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const call = mockDispatch.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.key).toBe("subscription.expiring_soon");
    expect(call.idempotencyKey).toBe("subscription-expiring-soon/org-1/2026-04-29");
    const params = call.params as Record<string, unknown>;
    expect(params.planName).toBe("pro");
    expect(params.daysUntilRenewal).toBe(7);
  });

  it("subscription.approaching_limit → per-org/per-dimension/per-day idempotency", async () => {
    eventBus.emit("subscription.approaching_limit", {
      ...baseEventPayload,
      organizationId: "org-1",
      planKey: "starter",
      dimension: "events",
      current: 8,
      limit: 10,
      percent: 80,
    });
    await flushAsync();
    await flushAsync();

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const call = mockDispatch.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.key).toBe("subscription.approaching_limit");
    expect(call.idempotencyKey).toBe(
      "subscription-approaching-limit/org-1/events/2026-04-22",
    );
    const params = call.params as Record<string, unknown>;
    expect(params.planName).toBe("starter");
    expect(params.dimensionLabel).toBe("Événements actifs");
    expect(params.current).toBe("8");
    expect(params.limit).toBe("10");
    expect(params.percent).toBe("80");
  });

  it("skips dispatch when the user cannot be resolved to an email recipient", async () => {
    mockUserFindById.mockResolvedValue(null);

    eventBus.emit("event.feedback_requested", {
      ...baseEventPayload,
      eventId: "ev-1",
      organizationId: "org-1",
      userId: "u-nope",
    });
    await flushAsync();
    await flushAsync();

    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
