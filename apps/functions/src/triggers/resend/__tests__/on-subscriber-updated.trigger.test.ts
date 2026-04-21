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

const { mockContactsCreate, mockContactsUpdate } = vi.hoisted(() => ({
  mockContactsCreate: vi.fn(),
  mockContactsUpdate: vi.fn(),
}));

vi.mock("../../../utils/resend-client", () => ({
  RESEND_API_KEY: { name: "RESEND_API_KEY", value: () => "re_test" },
  getResend: () => ({
    contacts: { create: mockContactsCreate, update: mockContactsUpdate },
  }),
}));

const { configState } = vi.hoisted(() => ({
  configState: { newsletterSegmentId: "seg_test" as string | undefined },
}));

vi.mock("../config-store", () => ({
  getResendSystemConfig: async () => ({ ...configState }),
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
  configState.newsletterSegmentId = "seg_test";
});

describe("onNewsletterSubscriberUpdated", () => {
  // ─── Transition 1: pending → confirmed (double opt-in completes) ────────

  describe("pending → confirmed (double-opt-in completion)", () => {
    it("creates a Resend contact in the configured segment", async () => {
      mockContactsCreate.mockResolvedValue({ data: { id: "cont_1" }, error: null });

      await handler(
        fakeUpdate(
          { email: "user@test.com", status: "pending", isActive: false },
          { email: "user@test.com", status: "confirmed", isActive: true },
        ),
      );

      expect(mockContactsCreate).toHaveBeenCalledWith({
        email: "user@test.com",
        segments: [{ id: "seg_test" }],
      });
      // NOT the update path — this is first-time Segment entry.
      expect(mockContactsUpdate).not.toHaveBeenCalled();
    });

    it("treats duplicate-contact (409) as success on confirmation", async () => {
      mockContactsCreate.mockResolvedValue({
        data: null,
        error: { name: "invalid_idempotent_request", message: "already exists" },
      });

      await expect(
        handler(
          fakeUpdate(
            { email: "dup@test.com", status: "pending" },
            { email: "dup@test.com", status: "confirmed" },
          ),
        ),
      ).resolves.toBeUndefined();
    });

    it("rethrows non-duplicate errors so Firestore retries the mirror", async () => {
      mockContactsCreate.mockResolvedValue({
        data: null,
        error: { name: "api_error", message: "server error" },
      });

      await expect(
        handler(
          fakeUpdate(
            { email: "user@test.com", status: "pending" },
            { email: "user@test.com", status: "confirmed" },
          ),
        ),
      ).rejects.toThrow(/api_error/);
    });

    it("skips cleanly when segment is not configured yet", async () => {
      configState.newsletterSegmentId = undefined;

      await handler(
        fakeUpdate(
          { email: "user@test.com", status: "pending" },
          { email: "user@test.com", status: "confirmed" },
        ),
      );

      expect(mockContactsCreate).not.toHaveBeenCalled();
    });
  });

  // ─── Transition 2: isActive flip (admin deactivate) ────────────────────

  describe("isActive flip (admin deactivate / reactivate)", () => {
    it("flips Resend contact.unsubscribed=true when isActive goes true → false", async () => {
      mockContactsUpdate.mockResolvedValue({ data: { id: "cont_1" }, error: null });

      await handler(
        fakeUpdate(
          { email: "u@test.com", status: "confirmed", isActive: true },
          { email: "u@test.com", status: "confirmed", isActive: false },
        ),
      );

      expect(mockContactsUpdate).toHaveBeenCalledWith({
        email: "u@test.com",
        unsubscribed: true,
      });
      // NOT the create path — this is an existing contact.
      expect(mockContactsCreate).not.toHaveBeenCalled();
    });

    it("flips unsubscribed=false when a subscriber is reactivated", async () => {
      mockContactsUpdate.mockResolvedValue({ data: { id: "cont_1" }, error: null });

      await handler(
        fakeUpdate(
          { email: "u@test.com", status: "confirmed", isActive: false },
          { email: "u@test.com", status: "confirmed", isActive: true },
        ),
      );

      expect(mockContactsUpdate).toHaveBeenCalledWith({
        email: "u@test.com",
        unsubscribed: false,
      });
    });

    it("rethrows on non-terminal Resend errors so Firestore retries", async () => {
      mockContactsUpdate.mockResolvedValue({
        data: null,
        error: { name: "api_error", message: "server error" },
      });

      await expect(
        handler(
          fakeUpdate(
            { email: "u@test.com", status: "confirmed", isActive: true },
            { email: "u@test.com", status: "confirmed", isActive: false },
          ),
        ),
      ).rejects.toThrow(/api_error/);
    });
  });

  // ─── No-op branches ────────────────────────────────────────────────────

  describe("no-op branches", () => {
    it("is a no-op when nothing relevant changed (touch-only update)", async () => {
      await handler(
        fakeUpdate(
          { email: "u@test.com", status: "confirmed", isActive: true, updatedAt: "a" },
          { email: "u@test.com", status: "confirmed", isActive: true, updatedAt: "b" },
        ),
      );

      expect(mockContactsCreate).not.toHaveBeenCalled();
      expect(mockContactsUpdate).not.toHaveBeenCalled();
    });

    it("is a no-op for pending→unsubscribed (contact was never created)", async () => {
      // A pending subscriber never landed in the Segment. If they're
      // retention-pruned, there's nothing to deactivate on the Resend side.
      await handler(
        fakeUpdate(
          { email: "u@test.com", status: "pending", isActive: false },
          { email: "u@test.com", status: "unsubscribed", isActive: false },
        ),
      );

      expect(mockContactsCreate).not.toHaveBeenCalled();
      expect(mockContactsUpdate).not.toHaveBeenCalled();
    });

    it("is a no-op when the doc has no email (defensive)", async () => {
      await handler(
        fakeUpdate(
          { isActive: true, status: "confirmed" },
          { isActive: false, status: "confirmed" },
        ),
      );
      expect(mockContactsUpdate).not.toHaveBeenCalled();
    });
  });
});
