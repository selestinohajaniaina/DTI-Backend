# DTI Backend — Don't Trash It

Express + TypeScript backend foundation for **DTI (Don't Trash It)**, an AI-powered
upcycling platform. This package contains the infrastructure only: HTTP server,
PostgreSQL access, authentication primitives, migrations, tests, and Docker setup.
AI integration and business features come later.

Frontend (Angular, untouched by this package): [`../DTI`](../DTI).

## Stack

| Concern    | Choice                                                   |
| ---------- | -------------------------------------------------------- |
| Runtime    | Node.js 24 LTS (see `.nvmrc`), npm                       |
| HTTP       | Express 5, Helmet, CORS                                  |
| Language   | TypeScript (strict), ESLint, Prettier                    |
| Database   | PostgreSQL 17 (Docker), Sequelize 6 (no decorators)      |
| Migrations | Umzug (`src/migrations/*.ts`)                            |
| Auth       | `jsonwebtoken` access tokens, `bcrypt` password hashing  |
| Validation | Zod (env at startup, request bodies per route)           |
| Tests      | Vitest + `light-my-request` against a real test database |
| Containers | Multi-stage Dockerfile (non-root) + Docker Compose       |

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
  `dist/` and the production container can run them from compiled JS.
- No refresh tokens yet: short-lived access tokens only (default 15 minutes).
  Refresh rotation can be added later with server-side reuse detection.

## Prerequisites

- Node.js 24 LTS (`nvm use`, or match `.nvmrc`) and npm 10+.
- Docker Engine + Docker Compose plugin (for PostgreSQL and container runs).
- The Angular frontend runs separately on <http://localhost:4200> by default.

## Environment setup

```bash
cp .env.example .env
cp .env.test.example .env.test
# Edit both files: set POSTGRES_PASSWORD, JWT_SECRET (32+ chars), etc.
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

## Local development (DB in Docker, API on host)

```bash
npm install
docker compose up -d db          # PostgreSQL on 127.0.0.1:5433
npm run db:migrate                # create tables (also runs automatically on boot)
npm run dev                       # API on http://127.0.0.1:3000 with live reload
```

Optional demo account: `npm run db:seed` creates `demo@dti.local / ChangeMe123!`
(refused in production unless `ALLOW_SEED_IN_PRODUCTION=true`).

## Containerized execution (API + DB in Docker)

```bash
docker compose up --build        # API on http://localhost:3000
docker compose up -d             # detached
docker compose logs -f api       # follow API logs
docker compose down              # stop; data is kept in the pgdata volume
```

The `api` service waits for the `db` healthcheck, runs pending migrations on
boot, and runs as the non-root `node` user. Compose reads `.env` for
interpolation; set `NODE_ENV=production` there for a production-like run.
PostgreSQL is reachable from the host only via `127.0.0.1:5433` (service `db`
itself is reachable as hostname `db` inside the private `backend` network).

## Containerized development with live reload (Compose Watch)

```bash
npm run dev:docker
# equivalent: docker compose -f docker-compose.yml -f docker-compose.dev.yml up --watch
```

This builds the `development` image target (full dependencies + `tsx watch`)
and starts Compose Watch: editing a file under `src/` (or `tests/`,
`tsconfig.json`) syncs it into the container and tsx restarts the API
automatically — no manual rebuild. `docker-compose.yml` is untouched, so plain
`docker compose up --build` keeps running the production image.

A rebuild happens automatically only when `package.json`, `package-lock.json`
or the `Dockerfile` changes. Restart manually after editing other
non-watched files (e.g. `.env`, `docker-compose.dev.yml` itself).

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

Data lifecycle:

- `docker compose down` keeps the `dti_pgdata` volume: data survives restarts.
- Reset everything (destroys data): `docker compose down -v`.

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

## Stopping and cleanup

```bash
docker compose stop        # pause containers, keep them
docker compose down        # stop + remove containers, keep data volume
docker compose down -v     # also delete the pgdata volume (data loss!)
```

## Troubleshooting

- **`Invalid environment configuration` on boot**: a required variable is
  missing or malformed; the message names each field (never values). Compare
  `.env` against `.env.example`.
- **API can't reach the DB locally**: is `db` running? (`docker compose ps`;
  expect `healthy`.) Local `DATABASE_URL` must use port `5433` (the Compose
  host mapping), while the containerized API uses hostname `db`.
- **`TEST_DATABASE_URL must point to a dedicated test database`**: rename the
  test database so it contains `test` (e.g. `dti_test`) and create it:
  `docker compose exec db psql -U dti -c 'CREATE DATABASE dti_test;'`.
- **Port already in use**: another Postgres on `5433`? Change `DB_HOST_PORT`
  in `.env` (and the `DATABASE_URL`/`TEST_DATABASE_URL` ports to match).
- **`relation "users" does not exist`**: run `npm run db:migrate`.
- **Docker build fails on `bcrypt`**: the image uses Debian-slim
  (`node:24-slim`) with prebuilt binaries; Alpine images would need a compiler
  toolchain for the native module.
- **npm 11 asks about install scripts**: `bcrypt`/`esbuild` are pre-approved
  via `allowScripts` in `package.json`, so `npm ci` works non-interactively.
