import { describe, it, expect } from "vitest";
import { extractErrorDescriptor, severityFor } from "../error-descriptor";

describe("extractErrorDescriptor", () => {
  it("returns UNKNOWN for null / undefined / primitives", () => {
    expect(extractErrorDescriptor(null)).toEqual({ code: "UNKNOWN", hasCode: false });
    expect(extractErrorDescriptor(undefined)).toEqual({ code: "UNKNOWN", hasCode: false });
    expect(extractErrorDescriptor("boom")).toEqual({ code: "UNKNOWN", hasCode: false });
    expect(extractErrorDescriptor(42)).toEqual({ code: "UNKNOWN", hasCode: false });
  });

  it("extracts the canonical ApiError shape thrown by the web clients", () => {
    const apiError = {
      code: "REGISTRATION_CLOSED",
      status: 400,
      message: "Les inscriptions ne sont pas encore ouvertes pour cet événement",
      details: { eventId: "evt_1", reason: "event_cancelled" },
    };
    expect(extractErrorDescriptor(apiError)).toEqual({
      code: "REGISTRATION_CLOSED",
      reason: "event_cancelled",
      status: 400,
      message: "Les inscriptions ne sont pas encore ouvertes pour cet événement",
      details: { eventId: "evt_1", reason: "event_cancelled" },
      hasCode: true,
    });
  });

  it("unwraps a server-shaped body { success, error: { code, message, details } }", () => {
    const serverBody = {
      success: false,
      error: {
        code: "EVENT_FULL",
        message: "Cet événement est complet.",
        details: { eventId: "evt_9" },
      },
    };
    const descriptor = extractErrorDescriptor(serverBody);
    expect(descriptor.code).toBe("EVENT_FULL");
    expect(descriptor.message).toBe("Cet événement est complet.");
    expect(descriptor.details).toEqual({ eventId: "evt_9" });
    expect(descriptor.hasCode).toBe(true);
  });

  it("uses statusCode when status is absent (Firebase / Node conventions)", () => {
    expect(extractErrorDescriptor({ code: "NOT_FOUND", statusCode: 404 }).status).toBe(404);
  });

  it("returns UNKNOWN when code is an empty string or non-string", () => {
    expect(extractErrorDescriptor({ code: "" }).code).toBe("UNKNOWN");
    expect(extractErrorDescriptor({ code: 42 }).code).toBe("UNKNOWN");
  });
});

describe("severityFor", () => {
  it("maps recoverable 4xx codes to warning", () => {
    expect(severityFor({ code: "REGISTRATION_CLOSED", hasCode: true })).toBe("warning");
    expect(severityFor({ code: "EVENT_FULL", hasCode: true })).toBe("warning");
    expect(severityFor({ code: "EMAIL_NOT_VERIFIED", hasCode: true })).toBe("warning");
    expect(severityFor({ code: "ORGANIZATION_PLAN_LIMIT", hasCode: true })).toBe("warning");
    expect(severityFor({ code: "RATE_LIMIT_EXCEEDED", hasCode: true })).toBe("warning");
  });

  it("maps already-in-state conflicts to info", () => {
    expect(severityFor({ code: "CONFLICT", hasCode: true })).toBe("info");
  });

  it("maps everything else (including unknown) to destructive", () => {
    expect(severityFor({ code: "UNKNOWN", hasCode: false })).toBe("destructive");
    expect(severityFor({ code: "INTERNAL_ERROR", hasCode: true })).toBe("destructive");
    expect(severityFor({ code: "VALIDATION_ERROR", hasCode: true })).toBe("destructive");
  });
});
