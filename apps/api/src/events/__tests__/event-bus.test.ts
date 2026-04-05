import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventBus } from "../event-bus";
import { type RegistrationCreatedEvent } from "../domain-events";

beforeEach(() => {
  eventBus.removeAllListeners();
});

function makePayload(overrides: Partial<RegistrationCreatedEvent> = {}): RegistrationCreatedEvent {
  return {
    registration: { id: "reg-1", eventId: "ev-1", userId: "u-1" } as any,
    eventId: "ev-1",
    organizationId: "org-1",
    actorId: "u-1",
    requestId: "req-123",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Flush setImmediate-scheduled callbacks */
const flushImmediate = () => new Promise((r) => setImmediate(r));

describe("EventBus", () => {
  it("delivers events to registered listeners", async () => {
    const handler = vi.fn();
    eventBus.on("registration.created", handler);

    const payload = makePayload();
    eventBus.emit("registration.created", payload);
    await flushImmediate();

    expect(handler).toHaveBeenCalledWith(payload);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("delivers to multiple listeners", async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    eventBus.on("registration.created", h1);
    eventBus.on("registration.created", h2);

    eventBus.emit("registration.created", makePayload());
    await flushImmediate();

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("isolates listener errors — other listeners still fire", async () => {
    const failing = vi.fn(() => { throw new Error("boom"); });
    const succeeding = vi.fn();

    eventBus.on("registration.created", failing);
    eventBus.on("registration.created", succeeding);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    eventBus.emit("registration.created", makePayload());
    await flushImmediate();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(succeeding).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("isolates async listener errors", async () => {
    const failing = vi.fn(async () => { throw new Error("async boom"); });
    const succeeding = vi.fn();

    eventBus.on("registration.created", failing);
    eventBus.on("registration.created", succeeding);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    eventBus.emit("registration.created", makePayload());
    await flushImmediate();
    // Allow microtask queue to drain for the async rejection handler
    await new Promise((r) => setImmediate(r));

    expect(succeeding).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not fire after listener is removed", async () => {
    const handler = vi.fn();
    eventBus.on("registration.created", handler);
    eventBus.off("registration.created", handler);

    eventBus.emit("registration.created", makePayload());
    await flushImmediate();

    expect(handler).not.toHaveBeenCalled();
  });

  it("removeAllListeners clears everything", async () => {
    const handler = vi.fn();
    eventBus.on("registration.created", handler);
    eventBus.on("checkin.completed", handler);
    eventBus.removeAllListeners();

    eventBus.emit("registration.created", makePayload());
    await flushImmediate();

    expect(handler).not.toHaveBeenCalled();
  });
});
