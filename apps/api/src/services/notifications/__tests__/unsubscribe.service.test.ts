import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTxGet, mockTxSet, mockEmit, mockDocFactory } = vi.hoisted(() => ({
  mockTxGet: vi.fn(),
  mockTxSet: vi.fn(),
  mockEmit: vi.fn(),
  mockDocFactory: vi.fn((id?: string) => ({ id: id ?? "unknown" })),
}));

vi.mock("@/config/firebase", () => ({
  db: {
    collection: () => ({ doc: (id?: string) => mockDocFactory(id) }),
    runTransaction: async (fn: (tx: unknown) => unknown) => {
      const tx = { get: mockTxGet, set: mockTxSet };
      return fn(tx);
    },
  },
  COLLECTIONS: { NOTIFICATION_PREFERENCES: "notificationPreferences" },
}));

vi.mock("@/events/event-bus", () => ({ eventBus: { emit: mockEmit } }));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "req-unsub",
}));

import { unsubscribeCategory } from "../unsubscribe.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("unsubscribeCategory", () => {
  it("writes emailTransactional=false + emits notification.unsubscribed", async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ emailTransactional: true, email: true }),
    });

    const result = await unsubscribeCategory({
      userId: "u-1",
      category: "transactional",
      source: "list_unsubscribe_click",
    });

    expect(result.alreadyUnsubscribed).toBe(false);
    expect(mockTxSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u-1" }),
      expect.objectContaining({
        id: "u-1",
        userId: "u-1",
        emailTransactional: false,
      }),
      { merge: true },
    );
    expect(mockEmit).toHaveBeenCalledWith(
      "notification.unsubscribed",
      expect.objectContaining({
        userId: "u-1",
        category: "transactional",
        source: "list_unsubscribe_click",
        actorId: "u-1",
      }),
    );
  });

  it("creates the prefs doc when one doesn't exist yet", async () => {
    mockTxGet.mockResolvedValue({ exists: false });

    await unsubscribeCategory({
      userId: "u-new",
      category: "organizational",
      source: "list_unsubscribe_click",
    });

    // `set({ merge: true })` creates the doc when it's missing — exactly
    // what we want for a brand-new user who clicks unsubscribe before
    // ever touching the Settings page.
    expect(mockTxSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        emailOrganizational: false,
        userId: "u-new",
      }),
      { merge: true },
    );
  });

  it("is idempotent — no write, no event when already unsubscribed", async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ emailTransactional: false }),
    });

    const result = await unsubscribeCategory({
      userId: "u-1",
      category: "transactional",
      source: "list_unsubscribe_post",
    });

    expect(result.alreadyUnsubscribed).toBe(true);
    expect(mockTxSet).not.toHaveBeenCalled();
    // Critical: Gmail prefetching the RFC 8058 one-click POST must not
    // spam the audit log with repeated unsubscribe events.
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("maps marketing to emailMarketing (not emailTransactional)", async () => {
    mockTxGet.mockResolvedValue({ exists: true, data: () => ({ emailMarketing: true }) });

    await unsubscribeCategory({
      userId: "u-1",
      category: "marketing",
      source: "list_unsubscribe_click",
    });

    expect(mockTxSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ emailMarketing: false }),
      { merge: true },
    );
  });

  it("differentiates sources in the emitted event (click vs one-click POST)", async () => {
    mockTxGet.mockResolvedValue({ exists: true, data: () => ({}) });

    await unsubscribeCategory({
      userId: "u-1",
      category: "transactional",
      source: "list_unsubscribe_post",
    });

    expect(mockEmit).toHaveBeenCalledWith(
      "notification.unsubscribed",
      expect.objectContaining({ source: "list_unsubscribe_post" }),
    );
  });
});
