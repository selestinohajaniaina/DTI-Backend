"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = exports.envSchema = void 0;
var zod_1 = require("zod");
var dotenv_1 = require("dotenv");
var node_path_1 = require("node:path");
// Load `.env.test` for tests, `.env` otherwise. Shell-provided variables
// always take precedence over file values (dotenv never overwrites them).
var nodeEnv = (_a = process.env.NODE_ENV) !== null && _a !== void 0 ? _a : 'development';
dotenv_1.default.config({
    path: node_path_1.default.resolve(process.cwd(), nodeEnv === 'test' ? '.env.test' : '.env'),
    quiet: true,
});
// Same units as jsonwebtoken/ms: bare number means seconds.
var expiresInPattern = /^\d+\s*(ms|s|m|h|d|w|y)?$/i;
var booleanFromString = zod_1.z
    .enum(['true', 'false'])
    .default('false')
    .transform(function (value) { return value === 'true'; });
var booleanFromStringDefaultTrue = zod_1.z
    .enum(['true', 'false'])
    .default('true')
    .transform(function (value) { return value === 'true'; });
var commaSeparatedUrls = zod_1.z
    .string()
    .min(1)
    .refine(function (value) {
    return value
        .split(',')
        .map(function (origin) { return origin.trim(); })
        .filter(function (origin) { return origin.length > 0; })
        .every(function (origin) {
        try {
            var url = new URL(origin);
            return url.protocol === 'http:' || url.protocol === 'https:';
        }
        catch (_a) {
            return false;
        }
    });
}, { message: 'must be a comma-separated list of http(s) URLs' });
function dbNameFromUrl(url) {
    try {
        return new URL(url).pathname.replace(/^\//, '').split('/')[0] || undefined;
    }
    catch (_a) {
        return undefined;
    }
}
exports.envSchema = zod_1.z
    .object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: zod_1.z.string().min(1).default('0.0.0.0'),
    FRONTEND_URL: commaSeparatedUrls.default('http://localhost:4200'),
    DATABASE_URL: zod_1.z.string().min(1).optional(),
    DB_HOST: zod_1.z.string().min(1).optional(),
    DB_PORT: zod_1.z.coerce.number().int().min(1).max(65535).optional(),
    DB_NAME: zod_1.z.string().min(1).optional(),
    DB_USER: zod_1.z.string().min(1).optional(),
    DB_PASSWORD: zod_1.z.string().optional(),
    DB_SSL: booleanFromString,
    // Keep certificate verification ON by default. Set to "false" ONLY when
    // the provider requires it: Render internal database URLs use self-signed
    // certificates, so verification must be disabled there (Render docs:
    // internal connections support `sslmode=require`, not verify-ca/verify-full).
    // External connections with provider-managed certificates keep "true".
    DB_SSL_REJECT_UNAUTHORIZED: booleanFromStringDefaultTrue,
    DB_LOGGING: booleanFromString,
    TEST_DATABASE_URL: zod_1.z.string().min(1).optional(),
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
    JWT_EXPIRES_IN: zod_1.z
        .string()
        .regex(expiresInPattern, 'JWT_EXPIRES_IN must look like "15m", "1h" or "3600"')
        .default('15m'),
    BCRYPT_ROUNDS: zod_1.z.coerce.number().int().min(4).max(31).default(12),
    // Optional: only /api/ai/* routes need it. Empty string counts as unset
    // so providers passing an empty MODEL_API_KEY do not break boot.
    MODEL_API_KEY: zod_1.z
        .string()
        .optional()
        .transform(function (value) { return (value && value.length > 0 ? value : undefined); }),
    META_API_BASE: zod_1.z.string().url().default('https://api.meta.ai/v1'),
    UPLOAD_DIR: zod_1.z.string().min(1).default('uploads'),
    ALLOW_SEED_IN_PRODUCTION: booleanFromString,
})
    .superRefine(function (value, ctx) {
    if (value.NODE_ENV === 'test') {
        if (!value.TEST_DATABASE_URL) {
            ctx.addIssue({
                code: 'custom',
                path: ['TEST_DATABASE_URL'],
                message: 'TEST_DATABASE_URL is required when NODE_ENV=test',
            });
        }
        else {
            var name_1 = dbNameFromUrl(value.TEST_DATABASE_URL);
            if (!name_1 || !name_1.toLowerCase().includes('test')) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['TEST_DATABASE_URL'],
                    message: 'TEST_DATABASE_URL must point to a dedicated test database ' +
                        '(database name containing "test")',
                });
            }
        }
        return;
    }
    var hasParts = value.DB_HOST && value.DB_PORT && value.DB_NAME && value.DB_USER;
    if (!value.DATABASE_URL && !hasParts) {
        ctx.addIssue({
            code: 'custom',
            path: ['DATABASE_URL'],
            message: 'Set DATABASE_URL or all of DB_HOST, DB_PORT, DB_NAME, DB_USER (+ DB_PASSWORD)',
        });
    }
});
var parsed = exports.envSchema.safeParse(process.env);
if (!parsed.success) {
    // Only field names and validation messages are reported here, never values.
    var lines = parsed.error.issues.map(function (issue) { return "  - ".concat(issue.path.join('.') || '(root)', ": ").concat(issue.message); });
    throw new Error("Invalid environment configuration:\n".concat(lines.join('\n')));
}
function resolveDatabaseUrl(values) {
    if (values.NODE_ENV === 'test' && values.TEST_DATABASE_URL) {
        return values.TEST_DATABASE_URL;
    }
    if (values.DATABASE_URL) {
        return values.DATABASE_URL;
    }
    if (values.DB_HOST && values.DB_PORT && values.DB_NAME && values.DB_USER) {
        var user = encodeURIComponent(values.DB_USER);
        var auth = values.DB_PASSWORD ? "".concat(user, ":").concat(encodeURIComponent(values.DB_PASSWORD)) : user;
        return "postgres://".concat(auth, "@").concat(values.DB_HOST, ":").concat(values.DB_PORT, "/").concat(values.DB_NAME);
    }
    // Unreachable: the schema refinement above rejects this state.
    throw new Error('Database configuration is incomplete');
}
var values = parsed.data;
exports.env = {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    host: values.HOST,
    frontendOrigins: values.FRONTEND_URL.split(',')
        .map(function (origin) { return origin.trim(); })
        .filter(function (origin) { return origin.length > 0; }),
    databaseUrl: resolveDatabaseUrl(values),
    dbSsl: values.DB_SSL,
    dbSslRejectUnauthorized: values.DB_SSL_REJECT_UNAUTHORIZED,
    dbLogging: values.DB_LOGGING,
    jwtSecret: values.JWT_SECRET,
    jwtExpiresIn: values.JWT_EXPIRES_IN,
    bcryptRounds: values.BCRYPT_ROUNDS,
    modelApiKey: values.MODEL_API_KEY,
    metaApiBase: values.META_API_BASE,
    uploadDir: values.UPLOAD_DIR,
    allowSeedInProduction: values.ALLOW_SEED_IN_PRODUCTION,
    isProduction: values.NODE_ENV === 'production',
    isTest: values.NODE_ENV === 'test',
};
