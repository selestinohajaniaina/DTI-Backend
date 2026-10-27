import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { AccessTokenPayload } from '../types/auth';
import { AppError } from './errors';

const SECONDS_PER_UNIT: Record<string, number> = {
  ms: 1 / 1000,
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  y: 31536000,
};

/**
 * Converts the validated JWT_EXPIRES_IN value ("15m", "1h", "3600") to whole
 * seconds for jsonwebtoken, which also accepts seconds as a number.
 */
export function expiresInSeconds(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d|w|y)?$/i.exec(value.trim());
  if (!match?.[1]) {
    // Unreachable: env.ts rejects values outside this format at startup.
    throw new Error(`Invalid JWT_EXPIRES_IN value: ${value}`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] ?? 's').toLowerCase();
  return Math.max(1, Math.floor(amount * (SECONDS_PER_UNIT[unit] ?? 1)));
}

export function signAccessToken(payload: { sub: string; email: string }): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: expiresInSeconds(env.jwtExpiresIn) });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = asRecord(jwt.verify(token, env.jwtSecret));
    const sub = decoded?.['sub'];
    const email = decoded?.['email'];
    if (typeof sub !== 'string' || typeof email !== 'string') {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid authentication token');
    }
    return { sub, email };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Authentication token has expired');
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid authentication token');
  }
}
