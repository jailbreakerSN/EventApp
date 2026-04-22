import { describe, it, expect } from "vitest";
import {
  DuplicateRegistrationError,
  RegistrationClosedError,
  ZoneFullError,
} from "@/errors/app-error";

// Pins the disambiguated registration-closed contract so UI clients can
// safely switch on `details.reason` (see docs/design-system/error-handling.md
// and packages/shared-types/src/event-availability.ts).

describe("RegistrationClosedError", () => {
  it("defaults reason to event_not_published for back-compat", () => {
    const err = new RegistrationClosedError("evt_1");
    expect(err.code).toBe("REGISTRATION_CLOSED");
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ eventId: "evt_1", reason: "event_not_published" });
    expect(err.message).toBe("Les inscriptions ne sont pas encore ouvertes pour cet événement");
  });

  it("serialises reason in details.reason when explicit", () => {
    const err = new RegistrationClosedError("evt_1", "event_cancelled");
    expect(err.details).toEqual({ eventId: "evt_1", reason: "event_cancelled" });
    expect(err.message).toBe("Cet événement a été annulé");
  });

  it("exposes a unique default French message per reason", () => {
    const reasons = [
      "event_not_published",
      "event_cancelled",
      "event_completed",
      "event_archived",
      "event_ended",
      "event_full",
    ] as const;
    const messages = reasons.map((r) => new RegistrationClosedError("evt_1", r).message);
    expect(new Set(messages).size).toBe(reasons.length);
  });

  it("toJSON emits { code, message, details }", () => {
    const err = new RegistrationClosedError("evt_42", "event_ended");
    expect(err.toJSON()).toEqual({
      code: "REGISTRATION_CLOSED",
      message: "La période d'inscription pour cet événement est terminée",
      details: { eventId: "evt_42", reason: "event_ended" },
    });
  });
});

// Pin the ZONE_FULL disambiguation so the staff-app UI can safely branch on
// `code === "ZONE_FULL"` instead of having to poke at details.zoneId.

describe("ZoneFullError", () => {
  it("uses the distinct ZONE_FULL code and 409 status", () => {
    const err = new ZoneFullError({ id: "zn_1", name: "Tente déjeuner", capacity: 120 });
    expect(err.code).toBe("ZONE_FULL");
    expect(err.statusCode).toBe(409);
  });

  it("serialises zone context in details", () => {
    const err = new ZoneFullError({ id: "zn_1", name: "Tente déjeuner", capacity: 120 });
    expect(err.details).toEqual({
      zoneId: "zn_1",
      zoneName: "Tente déjeuner",
      capacity: 120,
    });
  });

  it("tolerates a null/undefined capacity", () => {
    const err = new ZoneFullError({ id: "zn_2", name: "Salon VIP", capacity: null });
    expect(err.details).toEqual({ zoneId: "zn_2", zoneName: "Salon VIP", capacity: null });
    expect(err.message).toContain("—");
  });
});

// Pin the duplicate-registration disambiguation so the participant UI
// can safely branch on `code === "CONFLICT" && details.reason ===
// "duplicate_registration"` to render the targeted "Vous êtes déjà
// inscrit(e)" state with a "Voir mes inscriptions" CTA — instead of the
// generic CONFLICT copy that triggered the silent-failure loop.
describe("DuplicateRegistrationError", () => {
  it("uses CONFLICT/409 with duplicate_registration reason", () => {
    const err = new DuplicateRegistrationError("evt_1");
    expect(err.code).toBe("CONFLICT");
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({
      reason: "duplicate_registration",
      eventId: "evt_1",
    });
  });

  it("toJSON exposes reason for client switch", () => {
    const err = new DuplicateRegistrationError("evt_42");
    expect(err.toJSON()).toEqual({
      code: "CONFLICT",
      message: "Vous êtes déjà inscrit(e) à cet événement",
      details: { reason: "duplicate_registration", eventId: "evt_42" },
    });
  });
});
