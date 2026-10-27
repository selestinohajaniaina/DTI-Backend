import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/errors';

/** Validates req.body against a Zod schema and replaces it with the parsed value. */
export function validateBody<T>(
  schema: ZodType<T>,
): (req: Request, _res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body as unknown);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request data', details));
      return;
    }
    req.body = result.data;
    next();
  };
}
