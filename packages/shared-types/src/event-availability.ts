import type { Event } from "./event.types";

/**
 * Why registration for an event is unavailable. Mirrors the API's
 * `details.reason` contract so the UI, the error handler, and the
 * server speak the same language — see `docs/design-system/error-handling.md`.
 */
export type RegistrationUnavailableReason =
  | "event_not_published"
  | "event_cancelled"
  | "event_completed"
  | "event_archived"
  | "event_ended"
  | "event_full";

/**
 * Why a registration mutation conflicts with the current state. Carried
 * on `CONFLICT` 409 responses via `details.reason` so the UI can render
 * a targeted state instead of the generic "Action déjà effectuée" copy.
 */
export type RegistrationConflictReason = "duplicate_registration";

export type RegistrationAvailability =
  | { state: "open" }
  | { state: "requires_approval" }
  | { state: "unavailable"; reason: RegistrationUnavailableReason };

interface AvailabilityInput {
  status: Event["status"];
  startDate: string;
  endDate: string;
  maxAttendees?: number | null;
  registeredCount: number;
  requiresApproval?: boolean;
}

/**
 * Pure function — given an event snapshot, tells whether registration
 * can proceed, and if not, why. Callers use the reason to render an
 * actionable UI state instead of letting the user submit an invalid
 * request and eating a server 400.
 *
 * Parity with server: the matching API guards live in
 * `apps/api/src/services/registration.service.ts`. Keep these two
 * in sync — the server remains the source of truth; this helper
 * only exists so the UI can short-circuit obviously-broken paths.
 */
export function computeRegistrationAvailability(
  event: AvailabilityInput,
  now: Date = new Date(),
): RegistrationAvailability {
  if (event.status === "cancelled") {
    return { state: "unavailable", reason: "event_cancelled" };
  }
  if (event.status === "completed") {
    return { state: "unavailable", reason: "event_completed" };
  }
  if (event.status === "archived") {
    return { state: "unavailable", reason: "event_archived" };
  }
  if (event.status !== "published") {
    return { state: "unavailable", reason: "event_not_published" };
  }

  if (now > new Date(event.endDate)) {
    return { state: "unavailable", reason: "event_ended" };
  }

  const isFull =
    event.maxAttendees != null &&
    event.maxAttendees > 0 &&
    event.registeredCount >= event.maxAttendees;
  if (isFull && !event.requiresApproval) {
    return { state: "unavailable", reason: "event_full" };
  }

  if (event.requiresApproval) {
    return { state: "requires_approval" };
  }
  return { state: "open" };
}
