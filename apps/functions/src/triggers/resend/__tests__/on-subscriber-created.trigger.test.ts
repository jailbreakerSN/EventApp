import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("firebase-functions/params", () => ({
  defineSecret: (name: string) => ({ name, value: () => "re_test" }),
}));

const { mockContactsCreate } = vi.hoisted(() => ({
  mockContactsCreate: vi.fn(),
}));

vi.mock("../../../utils/resend-client", () => ({
  RESEND_API_KEY: { name: "RESEND_API_KEY", value: () => "re_test" },
  getResend: () => ({ contacts: { create: mockContactsCreate } }),
}));

const { configOverride } = vi.hoisted(() => ({
  configOverride: { newsletterSegmentId: "seg_test" as string | undefined },
}));
vi.mock("../config-store", () => ({
  getResendSystemConfig: async () => configOverride,
}));

import { onNewsletterSubscriberCreated } from "../on-subscriber-created.trigger";

// Handler shape: (event) => Promise<void>. Event carries params + data
// (a DocumentSnapshot-like). We pass the minimum the handler reads.
type FakeEvent = {
  params: { subscriberId: string };
  data?: { data: () => Record<string, unknown> };
};
const handler = onNewsletterSubscriberCreated as unknown as (event: FakeEvent) => Promise<void>;

function fakeEvent(subscriberId: string, doc: Record<string, unknown> | null): FakeEvent {
  return {
    params: { subscriberId },
    data: doc ? { data: () => doc } : undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  configOverride.newsletterSegmentId = "seg_test";
});

describe("onNewsletterSubscriberCreated", () => {
  it("creates a Resend contact for a confirmed subscriber", async () => {
    mockContactsCreate.mockResolvedValue({ data: { id: "cont_1" }, error: null });

    await handler(fakeEvent("sub-1", { email: "new@test.com", status: "confirmed" }));

    expect(mockContactsCreate).toHaveBeenCalledWith({
      email: "new@test.com",
      segments: [{ id: "seg_test" }],
    });
  });

  it("skips PENDING subscribers — double opt-in must complete first", async () => {
    await handler(fakeEvent("sub-1", { email: "pending@test.com", status: "pending" }));
    expect(mockContactsCreate).not.toHaveBeenCalled();
  });

  it("skips unsubscribed subscribers", async () => {
    await handler(fakeEvent("sub-1", { email: "unsub@test.com", status: "unsubscribed" }));
    expect(mockContactsCreate).not.toHaveBeenCalled();
  });

  it("grandfathers legacy rows with no status field as confirmed", async () => {
    mockContactsCreate.mockResolvedValue({ data: { id: "cont_2" }, error: null });
    // Pre-3c.2 subscribers were created without a status field — treat
    // them as already confirmed so we don't strand them pre-migration.
    await handler(fakeEvent("sub-1", { email: "legacy@test.com" }));

    expect(mockContactsCreate).toHaveBeenCalledWith({
      email: "legacy@test.com",
      segments: [{ id: "seg_test" }],
    });
  });

  it("is a no-op when the subscriber doc has no email", async () => {
    await handler(fakeEvent("sub-1", { isActive: true, status: "confirmed" }));
    expect(mockContactsCreate).not.toHaveBeenCalled();
  });

  it("is a no-op when the segment is not configured (bootstrap hasn't run)", async () => {
    configOverride.newsletterSegmentId = undefined;
    await handler(fakeEvent("sub-1", { email: "new@test.com" }));
    expect(mockContactsCreate).not.toHaveBeenCalled();
  });

  it("treats duplicate-contact errors as success (idempotent replays)", async () => {
    mockContactsCreate.mockResolvedValue({
      data: null,
      error: { name: "invalid_idempotent_request", message: "already exists" },
    });

    await expect(handler(fakeEvent("sub-1", { email: "dup@test.com" }))).resolves.toBeUndefined();
  });

  it("rethrows non-duplicate Resend errors so Firestore retries the trigger", async () => {
    mockContactsCreate.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "slow down" },
    });

    await expect(handler(fakeEvent("sub-1", { email: "throttled@test.com" }))).rejects.toThrow(
      /rate_limit_exceeded/,
    );
  });

  it("is a no-op when event.data is missing (unlikely — defensive)", async () => {
    await handler(fakeEvent("sub-1", null));
    expect(mockContactsCreate).not.toHaveBeenCalled();
  });
});
