import type { NextFunction, Request, Response } from 'express';
import type { ZodError, ZodType } from 'zod';
import { AppError } from '../utils/errors';

/** Shapes Zod issues into the standard 400 validation envelope details. */
export function toValidationError(error: ZodError, message = 'Invalid request data'): AppError {
  const details = error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

/** Validates req.body against a Zod schema and replaces it with the parsed value. */
export function validateBody<T>(
  schema: ZodType<T>,
): (req: Request, _res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body as unknown);
    if (!result.success) {
      next(toValidationError(result.error));
      return;
    }
    req.body = result.data;
    next();
  };
}
