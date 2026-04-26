import { describe, it, expect } from "vitest";
import { deriveCoOrganizerScope } from "../co-organizer-scope.helpers";

// ─── Co-organizer scope — pure derive helper ──────────────────────────────
//
// The hook itself is a thin React Query wrapper. The pure helper
// captures the entire decision logic (role check + single-event
// scope) so we test it independently of the hook plumbing.

describe("deriveCoOrganizerScope", () => {
  it("identifies a pure co-organizer (no `organizer` role)", () => {
    const out = deriveCoOrganizerScope({
      roles: ["co_organizer", "participant"],
      events: [{ id: "evt-1" }],
    });
    expect(out.isCoOrganizer).toBe(true);
    expect(out.scopedEventId).toBe("evt-1");
  });

  it("does NOT scope when the user has the broader organizer role", () => {
    // An organizer may also carry co_organizer for legacy reasons —
    // we treat them as full organizers, not as scoped co-orgs.
    const out = deriveCoOrganizerScope({
      roles: ["organizer", "co_organizer"],
      events: [{ id: "evt-1" }],
    });
    expect(out.isCoOrganizer).toBe(false);
    expect(out.scopedEventId).toBeUndefined();
  });

  it("does NOT auto-scope when the co-organizer manages 2+ events", () => {
    const out = deriveCoOrganizerScope({
      roles: ["co_organizer"],
      events: [{ id: "evt-1" }, { id: "evt-2" }],
    });
    expect(out.isCoOrganizer).toBe(true);
    expect(out.scopedEventId).toBeUndefined();
  });

  it("does NOT auto-scope when the co-organizer manages 0 events", () => {
    const out = deriveCoOrganizerScope({
      roles: ["co_organizer"],
      events: [],
    });
    expect(out.isCoOrganizer).toBe(true);
    expect(out.scopedEventId).toBeUndefined();
  });

  it("returns a non-co-organizer baseline for a regular participant", () => {
    const out = deriveCoOrganizerScope({
      roles: ["participant"],
      events: [],
    });
    expect(out.isCoOrganizer).toBe(false);
    expect(out.scopedEventId).toBeUndefined();
  });
});
