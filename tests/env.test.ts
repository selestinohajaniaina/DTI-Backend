import { describe, expect, it } from 'vitest';
import { envSchema } from '../src/config/env';

describe('GENERATED_IDEAS_COUNT', () => {
  it('defaults to 5 ideas per photo', () => {
    const parsed = envSchema.parse({ ...process.env, GENERATED_IDEAS_COUNT: undefined });

    expect(parsed.GENERATED_IDEAS_COUNT).toBe(5);
  });

  it('accepts custom values within 1 to 10', () => {
    expect(
      envSchema.parse({ ...process.env, GENERATED_IDEAS_COUNT: '1' }).GENERATED_IDEAS_COUNT,
    ).toBe(1);
    expect(
      envSchema.parse({ ...process.env, GENERATED_IDEAS_COUNT: '10' }).GENERATED_IDEAS_COUNT,
    ).toBe(10);
  });

  it('rejects out-of-range and non-numeric values at startup', () => {
    for (const value of ['0', '11', '-3', 'many', '']) {
      expect(() => envSchema.parse({ ...process.env, GENERATED_IDEAS_COUNT: value })).toThrow();
    }
  });
});
