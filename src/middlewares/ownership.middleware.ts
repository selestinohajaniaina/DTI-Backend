import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { GenerationOwnership } from '../types/ownership';
import { AppError } from '../utils/errors';

/** Client-presented stable identifier for anonymous callers (UUID format). */
export const ANONYMOUS_OWNER_HEADER = 'x-anonymous-owner-id';

const anonymousOwnerIdSchema = z.string().uuid();

/**
 * Resolves generation ownership from the verified auth context. Requires
 * requireAuth or optionalAuth earlier in the chain. Authenticated callers
 * are identified by user id; anonymous callers reuse their presented UUID
 * or receive a fresh server-generated one (echoed in the response).
 */
export function attachOwnership(req: Request, _res: Response, next: NextFunction): void {
  if (req.user) {
    const ownership: GenerationOwnership = { kind: 'user', userId: req.user.id };
    req.ownership = ownership;
    next();
    return;
  }
  const presented = req.header(ANONYMOUS_OWNER_HEADER);
  if (!presented) {
    const ownership: GenerationOwnership = {
      kind: 'anonymous',
      anonymousOwnerId: crypto.randomUUID(),
    };
    req.ownership = ownership;
    next();
    return;
  }
  const parsed = anonymousOwnerIdSchema.safeParse(presented.trim());
  if (!parsed.success) {
    next(new AppError(400, 'VALIDATION_ERROR', 'Invalid anonymous owner identifier'));
    return;
  }
  const ownership: GenerationOwnership = { kind: 'anonymous', anonymousOwnerId: parsed.data };
  req.ownership = ownership;
  next();
}
