import { describe, it, expect } from "vitest";
import { computeRegistrationAvailability } from "../event-availability";

// Shared "yesterday / today / tomorrow" anchors so we don't rely on wall-clock
// creep between test cases.
const NOW = new Date("2026-04-21T10:00:00Z");
const FUTURE = "2026-06-15T10:00:00Z";
const PAST = "2026-02-15T10:00:00Z";

function base() {
  return {
    status: "published" as const,
    startDate: FUTURE,
    endDate: FUTURE,
    maxAttendees: 100,
    registeredCount: 0,
    requiresApproval: false,
  };
}

describe("computeRegistrationAvailability", () => {
  it("returns open for a published future event with capacity", () => {
    expect(computeRegistrationAvailability(base(), NOW)).toEqual({ state: "open" });
  });

  it("returns requires_approval when the event needs organizer approval", () => {
    expect(computeRegistrationAvailability({ ...base(), requiresApproval: true }, NOW)).toEqual({
      state: "requires_approval",
    });
  });

  it("flags drafts as event_not_published", () => {
    expect(computeRegistrationAvailability({ ...base(), status: "draft" }, NOW)).toEqual({
      state: "unavailable",
      reason: "event_not_published",
    });
  });

  it("flags cancelled events as event_cancelled", () => {
    expect(computeRegistrationAvailability({ ...base(), status: "cancelled" }, NOW)).toEqual({
      state: "unavailable",
      reason: "event_cancelled",
    });
  });

  it("flags completed events as event_completed", () => {
    expect(computeRegistrationAvailability({ ...base(), status: "completed" }, NOW)).toEqual({
      state: "unavailable",
      reason: "event_completed",
    });
  });

  it("flags archived events as event_archived", () => {
    expect(computeRegistrationAvailability({ ...base(), status: "archived" }, NOW)).toEqual({
      state: "unavailable",
      reason: "event_archived",
    });
  });

  it("flags events past their endDate as event_ended", () => {
    expect(computeRegistrationAvailability({ ...base(), endDate: PAST }, NOW)).toEqual({
      state: "unavailable",
      reason: "event_ended",
    });
  });

  it("flags events at capacity as event_full when approval is not required", () => {
    expect(
      computeRegistrationAvailability({ ...base(), maxAttendees: 10, registeredCount: 10 }, NOW),
    ).toEqual({ state: "unavailable", reason: "event_full" });
  });

  it("treats approval events at capacity as waitlist_open (B2 — Phase 7+)", () => {
    // Mirrors the server: with requiresApproval=true, filled capacity does
    // not close registration — new entries land on the waitlist. Pre-B2
    // this returned `requires_approval` and the UI couldn't distinguish
    // "approval needed" from "waitlist". B2 introduces the dedicated
    // `waitlist_open` state so the participant CTA can offer "Rejoindre
    // la liste d'attente" instead of the bare "approval required".
    expect(
      computeRegistrationAvailability(
        { ...base(), maxAttendees: 10, registeredCount: 10, requiresApproval: true },
        NOW,
      ),
    ).toEqual({ state: "waitlist_open" });
  });

  it("ignores maxAttendees when it is null or zero", () => {
    expect(
      computeRegistrationAvailability({ ...base(), maxAttendees: null, registeredCount: 999 }, NOW),
    ).toEqual({ state: "open" });
    expect(
      computeRegistrationAvailability({ ...base(), maxAttendees: 0, registeredCount: 999 }, NOW),
    ).toEqual({ state: "open" });
  });

  it("prioritises cancelled over ended when both apply", () => {
    // Cancellation is what the participant needs to know — it's a stronger
    // signal than "the clock ran out".
    expect(
      computeRegistrationAvailability({ ...base(), status: "cancelled", endDate: PAST }, NOW),
    ).toEqual({ state: "unavailable", reason: "event_cancelled" });
  });
});
