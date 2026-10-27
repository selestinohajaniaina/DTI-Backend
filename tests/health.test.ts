import { inject } from 'light-my-request';
import { describe, expect, it } from 'vitest';
import { app, parseJson } from './helpers';

interface StatusBody {
  success: boolean;
  data: { status: string };
}

interface ErrorBody {
  success: boolean;
  error: { code: string };
}

describe('health endpoints', () => {
  it('GET /api/health returns ok', async () => {
    const res = await inject(app, { method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const body = parseJson<StatusBody>(res);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
  });

  it('GET /api/health/ready reports database connectivity', async () => {
    const res = await inject(app, { method: 'GET', url: '/api/health/ready' });

    expect(res.statusCode).toBe(200);
    const body = parseJson<StatusBody>(res);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ready');
  });

  it('unknown routes return the 404 envelope', async () => {
    const res = await inject(app, { method: 'GET', url: '/api/no-such-route' });

    expect(res.statusCode).toBe(404);
    const body = parseJson<ErrorBody>(res);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
