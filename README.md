# DTI Backend — Don't Trash It

Express + TypeScript backend foundation for **DTI (Don't Trash It)**, an AI-powered
upcycling platform. This package contains the infrastructure only: HTTP server,
PostgreSQL access, authentication primitives, migrations, tests, and AI routes.
Business features come later.

Frontend (Angular, untouched by this package): [`../DTI`](../DTI).

## Stack

| Concern    | Choice                                                              |
| ---------- | ------------------------------------------------------------------- |
| Runtime    | Node.js 24 LTS (see `.nvmrc`), npm                                  |
| HTTP       | Express 5, Helmet, CORS                                             |
| Language   | TypeScript (strict), ESLint, Prettier                               |
| Database   | External PostgreSQL via `DATABASE_URL`, Sequelize 6 (no decorators) |
| Migrations | Umzug (`src/migrations/*.ts`)                                       |
| Auth       | `jsonwebtoken` access tokens, `bcrypt` password hashing             |
| Validation | Zod (env at startup, request bodies per route)                      |
| Tests      | Vitest + `light-my-request` against a real test database            |

## Architecture

```text
src/
  server.ts            # Boot: env -> DB wait -> migrations -> listen -> shutdown
  app.ts               # Express factory (no listen; used by server and tests)
  config/
    env.ts             # Zod-validated env, fail fast; resolves DATABASE_URL
    database.ts        # Sequelize instance, pool, waitForDatabase()
    umzug.ts           # Migration runner (glob for app, inline list for tests)
  migrations/          # Versioned schema changes (*.ts; compiled to dist/)
  models/              # Explicit Sequelize models (User) + initModels()
  routes/              # /api/health, /api/auth
  controllers/         # Thin HTTP layer (status codes, envelopes)
  services/            # Business logic (register/login/profile)
  middlewares/         # auth, validate, request logger, 404, central errors
  validators/          # Zod request schemas
  seeders/             # Idempotent dev seed (demo user)
  scripts/             # migrate / seed CLIs
  types/               # JWT payload, PublicUser, req.user augmentation
  utils/               # logger, errors, response envelopes, jwt, password
tests/                 # Vitest suite (health + auth, real Postgres)
```

Notes on conventions:

- JSON responses always use `{ success: true, data }` or
  `{ success: false, error: { code, message, details? } }`.
- Controllers never touch the database directly; services never touch HTTP.
- No `sequelize.sync()` in the app: schema changes go through migrations only.
- Migrations live under `src/` (not repo root) so `tsc` compiles them into
  `dist/` and the production deploy can run them from compiled JS.
- No refresh tokens yet: short-lived access tokens only (default 15 minutes).
  Refresh rotation can be added later with server-side reuse detection.

## Prerequisites

- Node.js 24 LTS (`nvm use`, or match `.nvmrc`) and npm 10+.
- A reachable PostgreSQL instance: a managed provider (e.g. Render, Neon,
  Supabase) or a local PostgreSQL server. No Docker required.
- The Angular frontend runs separately on <http://localhost:4200> by default.

## Environment setup

```bash
cp .env.example .env
cp .env.test.example .env.test
# Edit both files: set DATABASE_URL, JWT_SECRET (32+ chars), etc.
# Generate a secret: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Never commit `.env` or `.env.test` (both are gitignored). All variables are
validated with Zod at startup; the process exits with a clear error when
required values are missing or malformed. Only field names are ever reported,
never values.

Database connection: set `DATABASE_URL`, or the `DB_HOST`/`DB_PORT`/`DB_NAME`/
`DB_USER`/`DB_PASSWORD` parts (the app composes a URL-encoded connection
string). Tests require `TEST_DATABASE_URL` pointing at a **dedicated database
whose name contains `test`** — anything else is refused so the suite can never
truncate dev/prod data.

## Local development

Point `DATABASE_URL` at any reachable PostgreSQL (managed provider or local
server), then:

```bash
npm ci
npm run db:migrate                # create tables (also runs automatically on boot)
npm run dev                       # API on http://127.0.0.1:3000 with live reload
```

Optional demo account: `npm run db:seed` creates `demo@dti.local / ChangeMe123!`
(refused in production unless `ALLOW_SEED_IN_PRODUCTION=true`).

Stop the server with `Ctrl+C`.

## Production build and deploy (Render)

Build and run the compiled output with `NODE_ENV=production`:

```bash
npm ci
npm run build                     # tsc emit to dist/
NODE_ENV=production npm start     # node dist/server.js
```

The server listens on `HOST` (defaults to `0.0.0.0`) and `PORT` (defaults to
`3000`; Render injects its own `PORT`). Leave `HOST` unset on Render.

Render web service settings (native Node runtime):

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/api/health`

Required environment variables on Render:

| Variable                     | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| `NODE_ENV`                   | `production`                                                |
| `DATABASE_URL`               | Render Postgres **internal** URL (auto-filled when linked)  |
| `DB_SSL`                     | `true`                                                      |
| `DB_SSL_REJECT_UNAUTHORIZED` | `false` (Render internal certs are self-signed — see below) |
| `JWT_SECRET`                 | Random secret, 32+ characters                               |
| `JWT_EXPIRES_IN`             | `15m` (optional, this is the default)                       |
| `FRONTEND_URL`               | Production frontend origin(s), comma-separated              |
| `MODEL_API_KEY`              | Meta API key (only needed for `/api/ai/*`)                  |

TLS note: Render internal database connections use self-signed certificates
(Render documents `sslmode=require`, with `verify-ca`/`verify-full`
unsupported), so `DB_SSL_REJECT_UNAUTHORIZED=false` is required there. For
external URLs or providers with valid certificates (Neon, Supabase, ...),
keep the default `true` so certificates are verified.

Migrations run automatically on every boot (`migrator.up()`, additive only —
never `sync({ alter|force })`). To migrate manually instead, run from any
machine with network access to the database:

```bash
DATABASE_URL='<external-url>' DB_SSL=true npm run db:migrate
```

Uploads note: generated images are stored on local disk under `UPLOAD_DIR`.
On Render without a persistent disk, that directory is ephemeral and files
disappear on redeploy — attach a disk or move to object storage if the
generated images must survive restarts.

## Database

```bash
npm run db:migrate          # apply pending migrations
npm run db:migrate:undo     # revert the most recent migration
npm run db:migrate:status   # show executed vs pending
npm run db:seed             # idempotent dev seed
```

New migration: add `src/migrations/<timestamp>-<name>.ts` exporting `up`/`down`
(Umzug style, see the initial `create-users` migration), then register it in
`tests/setup.ts` so the suite can import it statically.

Data lifecycle: the database is managed by your PostgreSQL provider (backups,
restores, and resets all happen there), never by this package.

## Testing, linting, build

```bash
npm test            # Vitest suite (needs TEST_DATABASE_URL database to exist)
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # ESLint (type-aware)
npm run format      # Prettier write
npm run build       # tsc emit to dist/
npm start           # run compiled production server (node dist/server.js)
```

The suite (17 tests) covers health/readiness/404, registration validation,
hashing, duplicate handling (including concurrent duplicates), login
success/failure, and JWT protection of `/api/auth/me` (missing, malformed,
invalid, expired tokens). Tests run sequentially against the isolated test
database and need no listening ports.

## API reference

Base URL (dev): `http://127.0.0.1:3000`

| Method | Path                     | Auth   | Description                                                          |
| ------ | ------------------------ | ------ | -------------------------------------------------------------------- |
| GET    | `/api/health`            | no     | Liveness (`{ status: "ok", ... }`)                                   |
| GET    | `/api/health/ready`      | no     | Readiness (checks DB, 503 if down)                                   |
| POST   | `/api/auth/register`     | no     | Register; 201 `{ user, token }`                                      |
| POST   | `/api/auth/login`        | no     | Login; 200 `{ user, token }`                                         |
| GET    | `/api/auth/me`           | Bearer | Current user; 401 without valid JWT                                  |
| POST   | `/api/ai/test`           | Bearer | Meta AI test prompt; 200 `{ model, answer }`                         |
| POST   | `/api/ai/generate-ideas` | no     | Photo-to-ideas (multipart `image`); 200 `{ sourceObject, ideas[3] }` |

Sample requests:

```bash
curl -X POST http://127.0.0.1:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","password":"Sup3rSecret!"}'

TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"Sup3rSecret!"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.token))")

curl http://127.0.0.1:3000/api/auth/me -H "Authorization: Bearer $TOKEN"
```

Error codes: `VALIDATION_ERROR`, `INVALID_JSON`, `NOT_FOUND`, `EMAIL_TAKEN`
(409), `INVALID_CREDENTIALS` (401, same for unknown email and wrong password),
`MISSING_TOKEN` / `INVALID_TOKEN` / `TOKEN_EXPIRED` (401), `USER_NOT_FOUND`,
`CONFLICT` (409), `DATABASE_UNAVAILABLE` (503), `AI_NOT_CONFIGURED` (503),
`AI_UPSTREAM_ERROR` (502), `AI_TIMEOUT` (504), `FILE_TOO_LARGE` (413),
`INTERNAL_ERROR` (500, no internals leaked in production).

### AI test route (Postman)

1. Set `MODEL_API_KEY` in `.env` (create one on the
   [Meta dashboard](https://dev.meta.ai)) and restart the API.
2. Register and log in to obtain a token (see Sample requests above).
3. Call the route:

```bash
curl -X POST http://127.0.0.1:3000/api/ai/test \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Suggest three ways to reuse an empty plastic bottle."}'
```

Without a key the route answers `503 AI_NOT_CONFIGURED`. Meta failures map to
`502 AI_UPSTREAM_ERROR` (or `504 AI_TIMEOUT`) without leaking internals. The
key travels in the server-side `Authorization` header only.

### Upcycling ideas (prototype)

`POST /api/ai/generate-ideas` accepts `multipart/form-data` with an `image`
field (JPEG/PNG/WebP/GIF verified by magic bytes, 10 MB max) and returns
`{ sourceObject, ideas[3] }`: title, description, difficulty, estimated
minutes, tutorial (materials, tools, steps, safety notes), market price
(always `not_found` for now — no fake research), and an illustration per idea.

```bash
curl -X POST http://127.0.0.1:3000/api/ai/generate-ideas \
  -F "image=@/path/to/photo.jpg"
```

Flow: Muse Spark analyzes the photo (JSON-schema-constrained output,
validated with Zod), then Muse Image (`muse-image-1.0` edits, original photo
as reference) illustrates each idea in parallel. Generated files are stored
under `<UPLOAD_DIR>/generated/` and served at `/uploads/...`. A failed
illustration yields `{ url: null, status: "failed" }` without dropping the
other ideas. The route is intentionally public for the anonymous demo;
add auth + rate limiting before any public exposure.

Persistence: every successful generation stores one `source_objects` row
(original photo key, detected name/material/condition) plus three
`generated_ideas` rows (tutorial, safety notes, market price, image
key/status) in a single transaction. Signed-in callers (optional
`Authorization: Bearer` header) are recorded via `ownerId`; anonymous
callers are grouped by `anonymousOwnerId`, taken from the
`X-Anonymous-Owner-Id` header when it holds a valid UUID and
server-generated otherwise (echoed as `anonymousOwnerId` in the response
so clients can persist and reuse it). The response adds `sourceObject.id`,
per-idea `ideaId`, and `anonymousOwnerId` to the existing shape. Only
storage keys live in PostgreSQL — image bytes stay on disk under
`UPLOAD_DIR` (`source/` for originals, `generated/` for illustrations),
so files still need a persistent disk (or object storage) to survive
redeploys; see the deploy section above.

### Authentication flow

1. Client POSTs credentials to `/api/auth/register` or `/api/auth/login`.
2. Server verifies (bcrypt compare), signs a JWT (`sub` = user id, `email`
   claim, configurable expiry, `JWT_SECRET` stays server-side).
3. Client sends `Authorization: Bearer <token>` on protected routes.
4. `requireAuth` verifies signature/expiry and sets typed `req.user`.

## Calling the backend from the Angular frontend

No frontend changes were made in this task. When wiring it up later, the
Angular app at `../DTI` only needs the base URL (default dev serving on
`:4200`, backend on `:3000`) — e.g. an `ApiService` with
`http.post('http://127.0.0.1:3000/api/auth/login', ...)`, storing the returned
token and attaching it as a Bearer header (an HTTP interceptor). CORS already
allows `FRONTEND_URL` (default `http://localhost:4200`). Never expose
`JWT_SECRET`, `DATABASE_URL`, or future AI provider keys to the browser.

## Troubleshooting

- **`Invalid environment configuration` on boot**: a required variable is
  missing or malformed; the message names each field (never values). Compare
  `.env` against `.env.example`.
- **API can't reach the DB**: check that `DATABASE_URL` points at a running,
  reachable PostgreSQL and that the provider's firewall/IP allow-list permits
  the connection. Managed providers require `DB_SSL=true`.
- **TLS `self-signed certificate` errors on Render**: the internal database
  URL needs `DB_SSL=true` with `DB_SSL_REJECT_UNAUTHORIZED=false` (Render's
  internal certificates are self-signed). Never set that flag to `false`
  for providers with valid certificates.
- **`TEST_DATABASE_URL must point to a dedicated test database`**: rename the
  test database so it contains `test` (e.g. `dti_test`) and create it on the
  server, e.g.: `psql "$DATABASE_URL" -c 'CREATE DATABASE dti_test;'`.
- **Port already in use**: another process on `PORT`? Change `PORT` in `.env`.
- **`relation "users" does not exist`**: run `npm run db:migrate`.
- **npm 11 asks about install scripts**: `bcrypt`/`esbuild` are pre-approved
  via `allowScripts` in `package.json`, so `npm ci` works non-interactively.
