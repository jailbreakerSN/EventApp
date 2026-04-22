import {
  type ErrorCode,
  ERROR_CODES,
  type RegistrationConflictReason,
  type RegistrationUnavailableReason,
} from "@teranga/shared-types";

/**
 * Base application error. All domain/business errors extend this.
 * The global error handler serializes these into consistent API responses.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(params: {
    message: string;
    code: ErrorCode;
    statusCode: number;
    details?: unknown;
    isOperational?: boolean;
    cause?: Error;
  }) {
    super(params.message, { cause: params.cause });
    this.name = this.constructor.name;
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.details = params.details;
    this.isOperational = params.isOperational ?? true;

    // Capture proper stack trace (V8 only)
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
    };
  }
}

// ─── Specific Error Types ─────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super({
      message: id ? `${resource} « ${id} » introuvable` : `${resource} introuvable`,
      code: ERROR_CODES.NOT_FOUND,
      statusCode: 404,
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentification requise") {
    super({
      message,
      code: ERROR_CODES.UNAUTHORIZED,
      statusCode: 401,
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Permissions insuffisantes") {
    super({
      message,
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });
  }
}

/**
 * 409 conflict — the operation contradicts the current state. Carry a
 * typed `reason` discriminator so the UI can render targeted copy
 * instead of the generic "Action déjà effectuée" fallback. New reason
 * unions live alongside `RegistrationConflictReason` in
 * `@teranga/shared-types/event-availability` (or a domain-specific
 * sibling) — keep client + server in sync.
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: { reason?: string } & Record<string, unknown>) {
    super({
      message,
      code: ERROR_CODES.CONFLICT,
      statusCode: 409,
      details,
    });
  }
}

/**
 * Convenience constructor for the "user already has an active
 * registration for this event" case. Mirrors the
 * `RegistrationConflictReason` union; new conflict shapes (e.g. invite
 * already accepted, member already in org) should follow the same
 * pattern: typed reason + dedicated factory.
 */
export class DuplicateRegistrationError extends ConflictError {
  constructor(eventId: string) {
    super("Vous êtes déjà inscrit(e) à cet événement", {
      reason: "duplicate_registration" satisfies RegistrationConflictReason,
      eventId,
    });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      message,
      code: ERROR_CODES.VALIDATION_ERROR,
      statusCode: 400,
      details,
    });
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string) {
    super({
      message,
      code: ERROR_CODES.QUOTA_EXCEEDED,
      statusCode: 403,
    });
  }
}

export class EventFullError extends AppError {
  constructor(eventId: string) {
    super({
      message: "Cet événement a atteint sa capacité maximale",
      code: ERROR_CODES.EVENT_FULL,
      statusCode: 409,
      details: { eventId },
    });
  }
}

/**
 * Raised by the live-scan check-in path when the scanned badge would
 * exceed an access zone's `capacity`. Mirrors the `zone_full` bulk-sync
 * result so staff see the same gating semantics regardless of whether
 * the scan is reconciled live or from the offline queue.
 *
 * Carries its own `ZONE_FULL` code (not the event-wide `EVENT_FULL`) so
 * the staff-app UI can distinguish "the whole event is at capacity" from
 * "this specific zone (e.g. the lunch tent) is full" without having to
 * poke at `details.zoneId`. Same 409 status as EventFullError.
 */
export class ZoneFullError extends AppError {
  constructor(zone: { id: string; name: string; capacity: number | null | undefined }) {
    super({
      message: `La zone « ${zone.name} » a atteint sa capacité (${zone.capacity ?? "—"}).`,
      code: ERROR_CODES.ZONE_FULL,
      statusCode: 409,
      details: {
        zoneId: zone.id,
        zoneName: zone.name,
        capacity: zone.capacity ?? null,
      },
    });
  }
}

/**
 * Registration is not accepted for this event. The `reason` field
 * disambiguates the six user-meaningful causes so the UI can render a
 * targeted blocking state instead of a single opaque "closed" message.
 *
 * The reasons mirror `RegistrationUnavailableReason` in
 * `@teranga/shared-types/event-availability` — the same contract the
 * web-participant preflight uses. Keep the two in sync.
 */
export class RegistrationClosedError extends AppError {
  constructor(eventId: string, reason: RegistrationUnavailableReason = "event_not_published") {
    super({
      message: REGISTRATION_CLOSED_MESSAGES[reason],
      code: ERROR_CODES.REGISTRATION_CLOSED,
      statusCode: 400,
      details: { eventId, reason },
    });
  }
}

// Default French messages — used by logs, SMS, mobile clients that haven't
// wired the i18n catalog yet. Web clients key off `details.reason` and render
// their own localized copy (see apps/web-participant i18n messages).
const REGISTRATION_CLOSED_MESSAGES: Record<RegistrationUnavailableReason, string> = {
  event_not_published: "Les inscriptions ne sont pas encore ouvertes pour cet événement",
  event_cancelled: "Cet événement a été annulé",
  event_completed: "Cet événement est terminé",
  event_archived: "Cet événement a été archivé",
  event_ended: "La période d'inscription pour cet événement est terminée",
  event_full: "Cet événement a atteint sa capacité maximale",
};

export class EmailNotVerifiedError extends AppError {
  constructor() {
    super({
      message:
        "Votre adresse e-mail n'est pas vérifiée. Vérifiez votre boîte de réception pour confirmer votre compte avant de vous inscrire à un événement payant.",
      code: ERROR_CODES.EMAIL_NOT_VERIFIED,
      statusCode: 403,
    });
  }
}

export class QrInvalidError extends AppError {
  constructor(reason: string) {
    super({
      message: `Code QR invalide : ${reason}`,
      code: ERROR_CODES.QR_INVALID,
      statusCode: 400,
    });
  }
}

/**
 * Raised when a scan targets a registration that is already `checked_in`.
 *
 * Details carry everything the gate staff need to distinguish a fraud
 * attempt from a "colleague got there first" moment — the scanner's
 * display name, their device id, and when the original scan landed.
 * Backoffice surfaces these on the red "Déjà validé par Aminata il y a
 * 12 s" card (badge-journey-review item 3.5).
 */
export class QrAlreadyUsedError extends AppError {
  constructor(
    details:
      | string
      | {
          checkedInAt?: string | null;
          /** uid of the staff who performed the first (winning) scan. */
          checkedInBy?: string | null;
          /** Denormalised display name for UI — resolved by the caller. */
          checkedInByName?: string | null;
          /** Device id persisted on the registration when the first scan landed. */
          checkedInDeviceId?: string | null;
        } = {},
  ) {
    // Back-compat: the old single-arg shape `new QrAlreadyUsedError(at)` is
    // kept so no in-flight callsite changes with this PR. New callers pass
    // the details object directly.
    const normalised = typeof details === "string" ? { checkedInAt: details } : details;
    const hasAny = Object.values(normalised).some((v) => v !== null && v !== undefined);
    super({
      message: "Ce badge a déjà été scanné",
      code: ERROR_CODES.QR_ALREADY_USED,
      statusCode: 409,
      details: hasAny ? normalised : undefined,
    });
  }
}

/**
 * Raised when a scan arrives AFTER the badge's signed validity window
 * (`notAfter`, with clock-skew grace). Shields against replay of QR codes
 * from past events.
 */
export class QrExpiredError extends AppError {
  constructor(notAfter?: string) {
    super({
      message: "Ce badge a expiré et ne peut plus être utilisé.",
      code: ERROR_CODES.QR_EXPIRED,
      statusCode: 410,
      details: notAfter ? { notAfter } : undefined,
    });
  }
}

/**
 * Raised when a scan arrives BEFORE the badge's signed validity window
 * (`notBefore`, with clock-skew grace). Prevents staff from accidentally
 * pre-scanning a badge days before doors open.
 */
export class QrNotYetValidError extends AppError {
  constructor(notBefore?: string) {
    super({
      message: "Ce badge n'est pas encore valide. Veuillez réessayer à l'heure de l'événement.",
      code: ERROR_CODES.QR_NOT_YET_VALID,
      statusCode: 425,
      details: notBefore ? { notBefore } : undefined,
    });
  }
}

/**
 * 500-class error with a safe user-facing message. Use when an upstream
 * dependency (Resend, Firebase, payment provider) fails and we don't want
 * its raw error text — which may carry internal identifiers, endpoint
 * names, or config details — to reach the client body in non-production
 * environments. Preserves the underlying error via `cause` so it still
 * lands in the Fastify request logger + Sentry breadcrumb.
 */
export class InternalError extends AppError {
  constructor(message = "Une erreur interne est survenue. Veuillez réessayer.", cause?: Error) {
    super({
      message,
      code: ERROR_CODES.INTERNAL_ERROR,
      statusCode: 500,
      cause,
      isOperational: false,
    });
  }
}

export class PlanLimitError extends AppError {
  constructor(
    limit: string,
    details?: { feature?: string; current?: number; max?: number; plan?: string },
  ) {
    super({
      message: `Limite du plan atteinte : ${limit}`,
      code: ERROR_CODES.ORGANIZATION_PLAN_LIMIT,
      statusCode: 403,
      details,
    });
  }
}
