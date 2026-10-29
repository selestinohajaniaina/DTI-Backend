export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'NOT_FOUND'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'USER_NOT_FOUND'
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'CONFLICT'
  | 'DATABASE_UNAVAILABLE'
  | 'AI_NOT_CONFIGURED'
  | 'AI_UPSTREAM_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_CANCELLED'
  | 'FILE_TOO_LARGE'
  | 'INTERNAL_ERROR';

/** Operational error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: unknown,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Native-style cause for server-side diagnosis. Unlike `details`, the
    // error middleware never serializes it to API clients.
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
