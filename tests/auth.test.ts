import jwt from 'jsonwebtoken';
import { inject } from 'light-my-request';
import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { User } from '../src/models/user.model';
import { verifyPassword } from '../src/utils/password';
import {
  app,
  demoUser,
  loginRequest,
  parseJson,
  registerAndGetToken,
  registerRequest,
} from './helpers';

interface AuthSuccessBody {
  success: boolean;
  data: {
    user: { id: string; name: string; email: string; createdAt: string; updatedAt: string };
    token: string;
  };
}

interface MeBody {
  success: boolean;
  data: { user: { id: string; name: string; email: string } };
}

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: unknown };
}

describe('POST /api/auth/register', () => {
  it('registers a user, hashes the password, and never returns the hash', async () => {
    const res = await registerRequest();

    expect(res.statusCode).toBe(201);
    const body = parseJson<AuthSuccessBody>(res);
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(demoUser.email);
    expect(typeof body.data.token).toBe('string');
    expect(res.body).not.toContain('passwordHash');

    const stored = await User.findOne({ where: { email: demoUser.email } });
    expect(stored).not.toBeNull();
    expect(stored?.passwordHash).not.toBe(demoUser.password);
    expect(await verifyPassword(demoUser.password, stored?.passwordHash ?? '')).toBe(true);
  });

  it('normalizes email addresses', async () => {
    const res = await registerRequest({ email: '  ADA@EXAMPLE.COM  ' });

    expect(res.statusCode).toBe(201);
    const stored = await User.findOne({ where: { email: 'ada@example.com' } });
    expect(stored).not.toBeNull();
  });

  it('rejects duplicate email addresses with 409', async () => {
    expect((await registerRequest()).statusCode).toBe(201);

    const res = await registerRequest();

    expect(res.statusCode).toBe(409);
    expect(parseJson<ErrorBody>(res).error.code).toBe('EMAIL_TAKEN');
  });

  it('handles concurrent duplicate registrations with one 201 and one 409', async () => {
    const [first, second] = await Promise.all([registerRequest(), registerRequest()]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
  });

  it('rejects malformed JSON bodies with 400', async () => {
    const res = await inject(app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: '{bad json',
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(400);
    expect(parseJson<ErrorBody>(res).error.code).toBe('INVALID_JSON');
  });

  it('rejects invalid input with 400', async () => {
    const res = await registerRequest({ email: 'not-an-email', password: 'short' });

    expect(res.statusCode).toBe(400);
    const body = parseJson<ErrorBody>(res);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects missing fields with 400', async () => {
    const res = await inject(app, { method: 'POST', url: '/api/auth/register', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(parseJson<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with valid credentials', async () => {
    await registerRequest();

    const res = await loginRequest();

    expect(res.statusCode).toBe(200);
    const body = parseJson<AuthSuccessBody>(res);
    expect(body.data.user.email).toBe(demoUser.email);
    expect(typeof body.data.token).toBe('string');
    expect(res.body).not.toContain('passwordHash');
  });

  it('rejects wrong passwords with 401', async () => {
    await registerRequest();

    const res = await loginRequest(demoUser.email, 'WrongPassword123!');

    expect(res.statusCode).toBe(401);
    expect(parseJson<ErrorBody>(res).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects unknown emails with the same 401 (no account enumeration)', async () => {
    const res = await loginRequest('ghost@example.com', 'Whatever123!');

    expect(res.statusCode).toBe(401);
    expect(parseJson<ErrorBody>(res).error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/auth/me', () => {
  it('rejects requests without a token', async () => {
    const res = await inject(app, { method: 'GET', url: '/api/auth/me' });

    expect(res.statusCode).toBe(401);
    expect(parseJson<ErrorBody>(res).error.code).toBe('MISSING_TOKEN');
  });

  it('rejects malformed and invalid tokens', async () => {
    for (const authorization of ['Bearer', 'Token abc', 'Bearer not-a-jwt']) {
      const res = await inject(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('rejects expired tokens', async () => {
    const expired = jwt.sign({ sub: 'some-id', email: 'x@y.z' }, env.jwtSecret, { expiresIn: -1 });
    const res = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${expired}` },
    });

    expect(res.statusCode).toBe(401);
    expect(parseJson<ErrorBody>(res).error.code).toBe('TOKEN_EXPIRED');
  });

  it('returns the authenticated user', async () => {
    const token = await registerAndGetToken();

    const res = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = parseJson<MeBody>(res);
    expect(body.data.user.email).toBe(demoUser.email);
    expect(res.body).not.toContain('passwordHash');
  });
});
