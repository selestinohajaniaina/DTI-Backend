import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';

// Load `.env.test` for tests, `.env` otherwise. Shell-provided variables
// always take precedence over file values (dotenv never overwrites them).
const nodeEnv = process.env.NODE_ENV ?? 'development';
dotenv.config({
  path: path.resolve(process.cwd(), nodeEnv === 'test' ? '.env.test' : '.env'),
  quiet: true,
});

// Same units as jsonwebtoken/ms: bare number means seconds.
const expiresInPattern = /^\d+\s*(ms|s|m|h|d|w|y)?$/i;

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const commaSeparatedUrls = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
        .every((origin) => {
          try {
            const url = new URL(origin);
            return url.protocol === 'http:' || url.protocol === 'https:';
          } catch {
            return false;
          }
        }),
    { message: 'must be a comma-separated list of http(s) URLs' },
  );

function dbNameFromUrl(url: string): string | undefined {
  try {
    return new URL(url).pathname.replace(/^\//, '').split('/')[0] || undefined;
  } catch {
    return undefined;
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    FRONTEND_URL: commaSeparatedUrls.default('http://localhost:4200'),
    DATABASE_URL: z.string().min(1).optional(),
    DB_HOST: z.string().min(1).optional(),
    DB_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    DB_NAME: z.string().min(1).optional(),
    DB_USER: z.string().min(1).optional(),
    DB_PASSWORD: z.string().optional(),
    DB_SSL: booleanFromString,
    DB_LOGGING: booleanFromString,
    TEST_DATABASE_URL: z.string().min(1).optional(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
    JWT_EXPIRES_IN: z
      .string()
      .regex(expiresInPattern, 'JWT_EXPIRES_IN must look like "15m", "1h" or "3600"')
      .default('15m'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(31).default(12),
    // Optional: only POST /api/ai/test needs it. Empty string counts as unset
    // so Compose can pass MODEL_API_KEY: ${MODEL_API_KEY:-} without breaking boot.
    MODEL_API_KEY: z
      .string()
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    ALLOW_SEED_IN_PRODUCTION: booleanFromString,
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'test') {
      if (!value.TEST_DATABASE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['TEST_DATABASE_URL'],
          message: 'TEST_DATABASE_URL is required when NODE_ENV=test',
        });
      } else {
        const name = dbNameFromUrl(value.TEST_DATABASE_URL);
        if (!name || !name.toLowerCase().includes('test')) {
          ctx.addIssue({
            code: 'custom',
            path: ['TEST_DATABASE_URL'],
            message:
              'TEST_DATABASE_URL must point to a dedicated test database ' +
              '(database name containing "test")',
          });
        }
      }
      return;
    }
    const hasParts = value.DB_HOST && value.DB_PORT && value.DB_NAME && value.DB_USER;
    if (!value.DATABASE_URL && !hasParts) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'Set DATABASE_URL or all of DB_HOST, DB_PORT, DB_NAME, DB_USER (+ DB_PASSWORD)',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Only field names and validation messages are reported here, never values.
  const lines = parsed.error.issues.map(
    (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

type EnvValues = z.infer<typeof envSchema>;

function resolveDatabaseUrl(values: EnvValues): string {
  if (values.NODE_ENV === 'test' && values.TEST_DATABASE_URL) {
    return values.TEST_DATABASE_URL;
  }
  if (values.DATABASE_URL) {
    return values.DATABASE_URL;
  }
  if (values.DB_HOST && values.DB_PORT && values.DB_NAME && values.DB_USER) {
    const user = encodeURIComponent(values.DB_USER);
    const auth = values.DB_PASSWORD ? `${user}:${encodeURIComponent(values.DB_PASSWORD)}` : user;
    return `postgres://${auth}@${values.DB_HOST}:${values.DB_PORT}/${values.DB_NAME}`;
  }
  // Unreachable: the schema refinement above rejects this state.
  throw new Error('Database configuration is incomplete');
}

const values: EnvValues = parsed.data;

export const env = {
  nodeEnv: values.NODE_ENV,
  port: values.PORT,
  host: values.HOST,
  frontendOrigins: values.FRONTEND_URL.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  databaseUrl: resolveDatabaseUrl(values),
  dbSsl: values.DB_SSL,
  dbLogging: values.DB_LOGGING,
  jwtSecret: values.JWT_SECRET,
  jwtExpiresIn: values.JWT_EXPIRES_IN,
  bcryptRounds: values.BCRYPT_ROUNDS,
  modelApiKey: values.MODEL_API_KEY,
  allowSeedInProduction: values.ALLOW_SEED_IN_PRODUCTION,
  isProduction: values.NODE_ENV === 'production',
  isTest: values.NODE_ENV === 'test',
};
