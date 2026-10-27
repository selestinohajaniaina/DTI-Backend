import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../types/auth';
import { AppError } from '../utils/errors';
import { verifyAccessToken } from '../utils/jwt';

/** Validates the Bearer token and attaches the caller's identity to req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError(401, 'MISSING_TOKEN', 'Missing or malformed authorization header'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(new AppError(401, 'MISSING_TOKEN', 'Missing authentication token'));
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    const user: AuthenticatedUser = { id: payload.sub, email: payload.email };
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
