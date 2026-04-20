import { type ErrorCode, ERROR_CODES } from "@teranga/shared-types";

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

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      message,
      code: ERROR_CODES.CONFLICT,
      statusCode: 409,
      details,
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

export class RegistrationClosedError extends AppError {
  constructor(eventId: string) {
    super({
      message: "Les inscriptions ne sont pas ouvertes pour cet événement",
      code: ERROR_CODES.REGISTRATION_CLOSED,
      statusCode: 400,
      details: { eventId },
    });
  }
}

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
