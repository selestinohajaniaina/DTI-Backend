import { inject } from 'light-my-request';
import { describe, expect, it } from 'vitest';
import { env, envSchema } from '../src/config/env';
import { app, parseJson } from './helpers';

const PRODUCTION_ORIGIN = 'https://dti-ai.vercel.app';
const FOREIGN_ORIGIN = 'https://not-allowed.example.test';

// Whatever the test environment configures, the first origin is allowed.
// (Schema guarantees at least one valid URL; the fallback only satisfies TS.)
const allowedOrigin = env.frontendOrigins[0] ?? 'http://localhost:4200';

describe('CORS', () => {
  it('allows the production frontend by default', () => {
    const parsed = envSchema.parse({ ...process.env, FRONTEND_URL: undefined });

    expect(parsed.FRONTEND_URL.split(',')).toContain(PRODUCTION_ORIGIN);
  });

  it('keeps the local development origin by default', () => {
    const parsed = envSchema.parse({ ...process.env, FRONTEND_URL: undefined });

    expect(parsed.FRONTEND_URL.split(',')).toContain('http://localhost:4200');
  });

  it('answers preflight with the allowed origin, methods and headers', async () => {
    const res = await inject(app, {
      method: 'OPTIONS',
      url: '/api/ai/generate-ideas',
      headers: {
        origin: allowedOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-anonymous-owner-id',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    const allowHeaders = res.headers['access-control-allow-headers'] ?? '';
    expect(allowHeaders.toLowerCase()).toContain('x-anonymous-owner-id');
  });

  it('includes CORS headers on application error responses', async () => {
    const res = await inject(app, {
      method: 'POST',
      url: '/api/ai/generate-ideas',
      headers: { origin: allowedOrigin },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(parseJson<{ error: { code: string } }>(res).error.code).toBe('VALIDATION_ERROR');
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });

  it('sends no CORS headers to disallowed origins', async () => {
    const res = await inject(app, {
      method: 'GET',
      url: '/api/health',
      headers: { origin: FOREIGN_ORIGIN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
