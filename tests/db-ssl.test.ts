import { describe, expect, it } from 'vitest';
import { sequelize } from '../src/config/database';
import { env, envSchema } from '../src/config/env';

// Guards the TLS verification default: certificate verification must stay ON
// unless explicitly disabled for providers with self-signed certificates
// (Render internal database URLs).

describe('database TLS verification', () => {
  it('keeps certificate verification enabled by default', () => {
    expect(env.dbSslRejectUnauthorized).toBe(true);
    const parsed = envSchema.parse({
      ...process.env,
      DB_SSL_REJECT_UNAUTHORIZED: undefined,
    });
    expect(parsed.DB_SSL_REJECT_UNAUTHORIZED).toBe(true);
  });

  it('honours an explicit opt-out (Render internal URLs)', () => {
    const parsed = envSchema.parse({
      ...process.env,
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'false',
    });
    expect(parsed.DB_SSL).toBe(true);
    expect(parsed.DB_SSL_REJECT_UNAUTHORIZED).toBe(false);
  });

  it('passes no SSL options when DB_SSL is unset', () => {
    expect(env.dbSsl).toBe(false);
    // Sequelize merges connection params into dialectOptions; only the
    // absence of `ssl` matters here.
    const internals = sequelize as unknown as {
      options?: { dialectOptions?: unknown };
    };
    const dialectOptions = (internals.options?.dialectOptions ?? {}) as Record<string, unknown>;
    expect('ssl' in dialectOptions).toBe(false);
  });
});
