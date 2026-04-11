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

export class QrInvalidError extends AppError {
  constructor(reason: string) {
    super({
      message: `Code QR invalide : ${reason}`,
      code: ERROR_CODES.QR_INVALID,
      statusCode: 400,
    });
  }
}

export class QrAlreadyUsedError extends AppError {
  constructor(checkedInAt?: string) {
    super({
      message: "Ce badge a déjà été scanné",
      code: ERROR_CODES.QR_ALREADY_USED,
      statusCode: 409,
      details: checkedInAt ? { checkedInAt } : undefined,
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
