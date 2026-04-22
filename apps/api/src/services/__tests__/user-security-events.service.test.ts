import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock event bus so we can assert emit calls.
vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

import { UserSecurityEventsService } from "../user-security-events.service";
import { eventBus } from "@/events/event-bus";

const service = new UserSecurityEventsService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UserSecurityEventsService.emitPasswordChanged", () => {
  it("emits user.password_changed with default actorId = userId (self-service)", () => {
    service.emitPasswordChanged("user-1", "self_service");

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.password_changed",
      expect.objectContaining({
        userId: "user-1",
        actorId: "user-1",
        requestId: "test-request-id",
      }),
    );
    const payload = vi.mocked(eventBus.emit).mock.calls[0]![1];
    expect(typeof (payload as { changedAt: string }).changedAt).toBe("string");
  });

  it("propagates ipAddress + city when provided", () => {
    service.emitPasswordChanged("user-1", "self_service", {
      ipAddress: "196.1.2.3",
      city: "Dakar",
    });

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.password_changed",
      expect.objectContaining({
        ipAddress: "196.1.2.3",
        city: "Dakar",
      }),
    );
  });

  it("uses the supplied actorId for admin_reset flows", () => {
    service.emitPasswordChanged("user-1", "admin_reset", { actorId: "admin-42" });

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.password_changed",
      expect.objectContaining({
        userId: "user-1",
        actorId: "admin-42",
      }),
    );
  });
});

describe("UserSecurityEventsService.emitEmailChanged", () => {
  it("emits user.email_changed with old + new email", () => {
    service.emitEmailChanged("user-1", "old@example.com", "new@example.com");

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.email_changed",
      expect.objectContaining({
        userId: "user-1",
        oldEmail: "old@example.com",
        newEmail: "new@example.com",
        actorId: "user-1",
      }),
    );
  });

  it("uses the supplied actorId when provided", () => {
    service.emitEmailChanged("user-1", "a@b.com", "b@c.com", { actorId: "admin-9" });

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.email_changed",
      expect.objectContaining({ actorId: "admin-9" }),
    );
  });
});
