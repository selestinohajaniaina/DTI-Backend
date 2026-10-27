import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';

/** Catches every request that matched no route. Registered before errorHandler. */
export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
}
