import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

import { UserLifecycleService } from "../user-lifecycle.service";
import { eventBus } from "@/events/event-bus";

const service = new UserLifecycleService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UserLifecycleService.emitUserCreated", () => {
  it("emits user.created with userId, email, and source mapped onto provider", () => {
    service.emitUserCreated("user-1", "alice@example.com", "self_signup");

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.created",
      expect.objectContaining({
        userId: "user-1",
        email: "alice@example.com",
        provider: "self_signup",
        actorId: "user-1",
        requestId: "test-request-id",
      }),
    );
  });

  it("tolerates null email (anonymous Firebase accounts)", () => {
    service.emitUserCreated("user-1", null, "admin");

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.created",
      expect.objectContaining({ email: null, provider: "admin" }),
    );
  });

  it("uses the supplied actorId for invite-acceptance flows", () => {
    service.emitUserCreated("user-1", "bob@example.com", "invite", {
      actorId: "inviter-42",
      displayName: "Bob",
    });

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.created",
      expect.objectContaining({
        userId: "user-1",
        actorId: "inviter-42",
        displayName: "Bob",
      }),
    );
  });
});
