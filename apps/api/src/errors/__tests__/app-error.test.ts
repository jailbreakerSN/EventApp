import { describe, it, expect } from "vitest";
import { RegistrationClosedError } from "@/errors/app-error";

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
