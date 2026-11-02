# DTI — Backend Rules (Express)

> Scope: This repository only. Shared rules: read `../AGENTS.md` (principles, efficiency, secrets, boundaries).
> Efficiency: Do not reanalyze the entire project. Start with this file, open only the relevant files, and expand the scope only when necessary.

## Verified Stack

- Node.js 24 LTS (`.nvmrc`), npm, Express 5, TypeScript 5.9 strict (CommonJS, **no decorators**).
- Sequelize 6 (explicit classes, **no `sequelize-typescript`**) + `pg`, external PostgreSQL via `DATABASE_URL` (no Docker).
- `jsonwebtoken` (short-lived access tokens), `bcrypt`, Zod, Umzug, `tsx` (development), Vitest + `light-my-request` (tests).

## Actual Architecture

- `server.ts`: bootstrap (env → wait for DB → read-only check that the schema is up to date, never applies migrations → `listen` → graceful shutdown on SIGTERM/SIGINT).
- `app.ts`: Express factory without `listen` (reused by tests).
- Request flow: `routes/` → `controllers/` (thin, `asyncHandler`, `sendSuccess`) → `services/` (business logic) → `models/`.
- `middlewares/`: `auth` (Bearer → typed `req.user`), `validate` (Zod replaces `req.body`), `request-logger` (path only), `not-found`, `error` (centralized).
- `validators/`: Zod schemas; `types/auth.ts`: JWT payload, `PublicUser` (never expose `passwordHash`), `req.user` augmentation.
- `utils/`: `errors` (`AppError`), `response` (response envelopes), `jwt`, `password`, JSON `logger` (never logs secrets), `async-handler`.
- `config/`: `env` (Zod fail-fast validation), `database` (Sequelize, pool, `waitForDatabase`), `umzug`.
- `models/`: explicit definitions + `initModels()`; `User`: UUID, `name`, normalized unique `email`, `passwordHash`, timestamps. `SourceObject` (source photo + exclusive ownership through `ownerId`/`anonymousOwnerId`, XOR constraint at database level) `hasMany` `GeneratedIdea` (JSONB tutorials, `imagePath` null on failure, JSONB `marketPrice` + `marketPriceMga` archive); cascading deletes.

## Conventions

- Responses: `{ success: true, data }` / `{ success: false, error: { code, message, details? } }`, stable error codes (`VALIDATION_ERROR`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `MISSING/INVALID_TOKEN`, `TOKEN_EXPIRED`, ...).
- Errors: `AppError(status, code, message)`; Sequelize errors are mapped (unique constraint → 409, validation → 400, malformed JSON → 400); generic 500 responses in production, without stack traces or internal details.
- Systematic Zod input validation (`validateBody`); emails handled through `normalizeEmail()`; uniform login responses (anti-enumeration); never trust a client-provided ID instead of `req.user`.
- Database: Umzug migrations in `src/migrations/` **only** (never use `sync({ alter|force })`); **add every new migration to the static list in `tests/migration-list.ts`** (the glob does not load `.ts` files under Vitest; this list is shared by `tests/setup.ts` and CLI tests); idempotent seed `seeders/dev.seed.ts`, blocked in production unless explicitly overridden.
- AI: shared transport `services/meta.client.ts` (native `fetch`, timeouts, bounded retries with backoff + jitter, respects `Retry-After`, 502/504/499 errors with preserved causes, sanitized logs containing `operation`/`phase`/`codes`, never logs API keys); `services/ai.service.ts` (text test); `services/ideas.service.ts` (Spark `json_schema` + N illustrations using `muse-image-1.0` in parallel with the source photo as a reference, per-idea failures preserved, transactional persistence of the source + valid ideas when `ownership` is provided, typed overrides); uploads use `multer` memory storage + magic-byte validation (`utils/image.ts`); images are served through `/uploads` (`express.static`).
- Generation: `GENERATED_IDEAS_COUNT` (default 5, range 1–10, validated at boot) determines the number of requested ideas; tolerant parsing (invalid entries and duplicates are discarded, never padded, 502 if nothing usable remains); AI-estimated prices in USD (dollar amounts with optional cents, rounded to the nearest cent; canonical `marketPrice` format: `{status:"estimated", currency:"USD", estimatedCost, estimatedSellingPrice}`; currency assigned by the server — AI schema has no currency field; amounts are `null` when uncertain; legacy `not_found` and non-USD entries are degraded to empty estimates through `normalizeStoredMarketPrice()`; migration `20261030000001` converts MGA entries using the documented exchange rate while preserving originals in `marketPriceMga`; no web searches).
- Generation endpoint: public `POST /api/ai/generate-ideas` with `optionalAuth` (if an authorization header is present but invalid → 401) + `attachOwnership` (`req.ownership`, `X-Anonymous-Owner-Id` header validated as UUID, otherwise a server-generated UUID is returned); response is extended additively (`sourceObject.id`, `ideaId`, `anonymousOwnerId`).
- Library: `GET /api/ai/ideas` (search/filter/sort/pagination via `validators/library.validator.ts`, `library.service.ts`) + `GET /api/ai/source-objects` (filter options, cap of 100); `resolveOwnership` (never mints an identity; missing identity → empty page); legacy prices normalized on read.
- Environment: `DATABASE_URL` or `DB_*` components, `TEST_DATABASE_URL` (name must contain `test`, with dev/prod isolation guard), `JWT_SECRET` (32+ characters), `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`, `MODEL_API_KEY` (optional, required for `/api/ai/*`), `UPLOAD_DIR` (default `uploads`), `META_API_BASE` (staging/mock override); `.env`/`.env.test` are gitignored; secrets and AI keys must remain exclusively on the server.
- Security: Helmet, CORS restricted to `FRONTEND_URL`, JSON payload limit of 100 KB, ORM-based queries (parameterized, never concatenated SQL), no secrets/tokens/passwords in logs; future external APIs must be called from the backend with timeouts and error handling.
- External database: managed PostgreSQL via `DATABASE_URL` (`DB_SSL=true` in production; `DB_SSL_REJECT_UNAUTHORIZED=false` only for internal Render URLs with documented self-signed certificates). Development: run `npm run dev` directly. Production: `NODE_ENV=production`, `npm run build` + `npm start`, listening on `0.0.0.0` using `PORT`.

## Commands (Verified, Run from `DTI-Backend/`)

- `npm run dev` (watch mode), `npm start` (compiled), `npm run build`, `npm run typecheck`.
- `npm run lint` / `lint:fix`, `npm run format` / `format:check`.
- `npm test` / `test:watch` (test database required, sequential test suite).
- `npm run db:migrate` / `db:migrate:undo` / `db:migrate:status`, `npm run db:seed`.
- Deployment: no Docker — `npm ci && npm run build`, then `npm run db:migrate && npm start` (`NODE_ENV=production`); only `db:migrate` applies migrations (never during bootstrap, which only checks and refuses to start if migrations are pending); manual execution: `DATABASE_URL='&lt;url&gt;' npm run db:migrate`.