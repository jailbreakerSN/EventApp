import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentUpdated: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("firebase-functions/params", () => ({
  defineSecret: (name: string) => ({ name, value: () => "re_test" }),
}));

const { mockContactsUpdate } = vi.hoisted(() => ({
  mockContactsUpdate: vi.fn(),
}));

vi.mock("../../../utils/resend-client", () => ({
  RESEND_API_KEY: { name: "RESEND_API_KEY", value: () => "re_test" },
  getResend: () => ({ contacts: { update: mockContactsUpdate } }),
}));

import { onNewsletterSubscriberUpdated } from "../on-subscriber-updated.trigger";

type FakeEvent = {
  params: { subscriberId: string };
  data?: {
    before: { data: () => Record<string, unknown> };
    after: { data: () => Record<string, unknown> };
  };
};

const handler = onNewsletterSubscriberUpdated as unknown as (event: FakeEvent) => Promise<void>;

function fakeUpdate(before: Record<string, unknown>, after: Record<string, unknown>): FakeEvent {
  return {
    params: { subscriberId: "sub-1" },
    data: {
      before: { data: () => before },
      after: { data: () => after },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("onNewsletterSubscriberUpdated", () => {
  it("flips Resend contact.unsubscribed=true when isActive goes true → false", async () => {
    mockContactsUpdate.mockResolvedValue({ data: { id: "cont_1" }, error: null });

    await handler(
      fakeUpdate({ email: "u@test.com", isActive: true }, { email: "u@test.com", isActive: false }),
    );

    expect(mockContactsUpdate).toHaveBeenCalledWith({
      email: "u@test.com",
      unsubscribed: true,
    });
  });

  it("flips unsubscribed=false when a subscriber is reactivated", async () => {
    mockContactsUpdate.mockResolvedValue({ data: { id: "cont_1" }, error: null });

    await handler(
      fakeUpdate({ email: "u@test.com", isActive: false }, { email: "u@test.com", isActive: true }),
    );

    expect(mockContactsUpdate).toHaveBeenCalledWith({
      email: "u@test.com",
      unsubscribed: false,
    });
  });

  it("is a no-op when isActive did not change (e.g. only updatedAt touched)", async () => {
    await handler(
      fakeUpdate(
        { email: "u@test.com", isActive: true, updatedAt: "a" },
        { email: "u@test.com", isActive: true, updatedAt: "b" },
      ),
    );

    expect(mockContactsUpdate).not.toHaveBeenCalled();
  });

  it("rethrows on non-terminal Resend errors so Firestore retries", async () => {
    mockContactsUpdate.mockResolvedValue({
      data: null,
      error: { name: "api_error", message: "server error" },
    });

    await expect(
      handler(
        fakeUpdate(
          { email: "u@test.com", isActive: true },
          { email: "u@test.com", isActive: false },
        ),
      ),
    ).rejects.toThrow(/api_error/);
  });

  it("is a no-op when the doc has no email (shouldn't happen; defensive)", async () => {
    await handler(fakeUpdate({ isActive: true }, { isActive: false }));
    expect(mockContactsUpdate).not.toHaveBeenCalled();
  });
});
