import type { Request, Response } from 'express';
import { checkDatabase } from '../config/database';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../utils/errors';
import { sendSuccess } from '../utils/response';

/** Liveness: the process is running. No dependency checks, no secrets. */
export function getHealth(_req: Request, res: Response): void {
  sendSuccess(res, {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}

/** Readiness: the process can serve traffic (database reachable). */
export const getReadiness = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  try {
    await checkDatabase();
  } catch {
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is not reachable');
  }
  sendSuccess(res, { status: 'ready', timestamp: new Date().toISOString() });
});
