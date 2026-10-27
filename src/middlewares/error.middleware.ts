import type { NextFunction, Request, Response } from 'express';
import { UniqueConstraintError, ValidationError } from 'sequelize';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { ErrorEnvelope } from '../utils/response';

function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  if (res.headersSent) {
    return;
  }
  const body: ErrorEnvelope = { success: false, error: { code, message, details } };
  res.status(statusCode).json(body);
}

function isJsonParseError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }
  const candidate = error as Partial<SyntaxError> & { status?: unknown; type?: unknown };
  return (
    candidate.status === 400 &&
    typeof candidate.type === 'string' &&
    candidate.type.startsWith('entity.')
  );
}

/** Centralized error handler. Must be registered after all routes. */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error('request failed', {
        path: req.path,
        status: error.statusCode,
        code: error.code,
      });
    } else {
      logger.debug('request rejected', {
        path: req.path,
        status: error.statusCode,
        code: error.code,
      });
    }
    sendError(res, error.statusCode, error.code, error.message, error.details);
    return;
  }

  if (error instanceof UniqueConstraintError) {
    // Race-safe backstop: the service layer checks duplicates first, the
    // database constraint wins when two requests race.
    const fields = Object.keys(error.fields ?? {});
    if (fields.includes('email')) {
      sendError(res, 409, 'EMAIL_TAKEN', 'Email address is already registered');
    } else {
      logger.warn('unique constraint violation', { path: req.path, fields });
      sendError(res, 409, 'CONFLICT', 'Resource already exists');
    }
    return;
  }

  if (error instanceof ValidationError) {
    const details = error.errors.map((item) => ({ path: item.path ?? '', message: item.message }));
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid request data', details);
    return;
  }

  if (isJsonParseError(error)) {
    sendError(res, 400, 'INVALID_JSON', 'Malformed JSON body');
    return;
  }

  logger.error('unhandled error', { path: req.path, method: req.method, error });
  const message =
    env.isProduction || !(error instanceof Error) ? 'Internal server error' : error.message;
  sendError(res, 500, 'INTERNAL_ERROR', message);
}
