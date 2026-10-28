# DTI — Règles backend (Express)

> Périmètre : ce dépôt uniquement. Règles communes : lire `../AGENTS.md`
> (principes, efficacité, secrets, frontières).
> Efficacité : ne pas réanalyser le projet — partir de ce fichier, ouvrir
> uniquement les fichiers concernés, élargir seulement si nécessaire.

## Stack (vérifiée)

- Node.js 24 LTS (`.nvmrc`), npm, Express 5, TypeScript 5.9 strict (CommonJS, **sans décorateurs**).
- Sequelize 6 (classes explicites, **sans `sequelize-typescript`**) + `pg`, PostgreSQL externe via `DATABASE_URL` (sans Docker).
- `jsonwebtoken` (access tokens courts), `bcrypt`, Zod, Umzug, `tsx` (dev), Vitest + `light-my-request` (tests).

## Architecture réelle

- `server.ts` : boot (env → attente DB → migrations → `listen` → arrêt gracieux SIGTERM/SIGINT).
- `app.ts` : fabrique Express sans `listen` (réutilisée par les tests).
- Flux : `routes/` → `controllers/` (minces, `asyncHandler`, `sendSuccess`) → `services/` (logique) → `models/`.
- `middlewares/` : `auth` (Bearer → `req.user` typé), `validate` (Zod remplace `req.body`), `request-logger` (path uniquement), `not-found`, `error` (central).
- `validators/` : schémas Zod ; `types/auth.ts` : payload JWT, `PublicUser` (jamais `passwordHash`), augmentation `req.user`.
- `utils/` : `errors` (`AppError`), `response` (enveloppes), `jwt`, `password`, `logger` JSON (jamais de secrets), `async-handler`.
- `config/` : `env` (Zod fail-fast), `database` (Sequelize, pool, `waitForDatabase`), `umzug`.
- `models/` : définitions explicites + `initModels()` ; `User` : UUID, `name`, `email` unique normalisé, `passwordHash`, timestamps. `SourceObject` (photo source + propriétaire exclusif `ownerId`/`anonymousOwnerId`, contrainte XOR en base) `hasMany` `GeneratedIdea` (tutos JSONB, `imagePath` nul si échec, `marketPrice` JSONB) ; suppressions en cascade.

## Conventions

- Réponses : `{ success: true, data }` / `{ success: false, error: { code, message, details? } }`, codes stables (`VALIDATION_ERROR`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `MISSING/INVALID_TOKEN`, `TOKEN_EXPIRED`, ...).
- Erreurs : `AppError(status, code, message)` ; erreurs Sequelize mappées (contrainte unique → 409, validation → 400, JSON malformé → 400) ; 500 générique en production, sans stack ni détails internes.
- Validation Zod systématique des entrées (`validateBody`) ; emails via `normalizeEmail()` ; login à réponse uniforme (anti-énumération) ; ne jamais faire confiance à un id client à la place de `req.user`.
- Base : migrations Umzug dans `src/migrations/` **uniquement** (jamais `sync({ alter|force })`) ; **ajouter chaque nouvelle migration à la liste statique de `tests/setup.ts`** (le glob ne charge pas le `.ts` sous Vitest) ; seed idempotent `seeders/dev.seed.ts`, refusé en production sauf override explicite.
- IA : transport partagé `services/meta.client.ts` (`fetch` natif, timeouts, erreurs 502/504, jamais de clé loguée) ; `services/ai.service.ts` (test texte) ; `services/ideas.service.ts` (Spark `json_schema` + 3 illustrations `muse-image-1.0` en parallèle avec photo en référence, échec par idée préservé, persistance transactionnelle source + 3 idées quand `ownership` fourni, surcharges typées) ; upload `multer` mémoire + magic bytes (`utils/image.ts`) ; images servies via `/uploads` (express.static).
- Générations : route `POST /api/ai/generate-ideas` publique avec `optionalAuth` (en-tête présent mais invalide → 401) + `attachOwnership` (`req.ownership`, en-tête `X-Anonymous-Owner-Id` validé UUID, sinon UUID serveur renvoyé) ; réponse étendue de façon additive (`sourceObject.id`, `ideaId`, `anonymousOwnerId`).
- Env : `DATABASE_URL` ou parties `DB_*`, `TEST_DATABASE_URL` (nom contenant `test`, garde anti dev/prod), `JWT_SECRET` 32+ caractères, `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`, `MODEL_API_KEY` (optionnel, requis pour `/api/ai/*`), `UPLOAD_DIR` (défaut `uploads`), `META_API_BASE` (override staging/mocks) ; `.env`/`.env.test` gitignorés ; secrets et clés IA exclusivement serveur.
- Sécurité : Helmet, CORS sur `FRONTEND_URL`, JSON limité à 100kb, requêtes via l'ORM (paramétrées, jamais de SQL concaténé), pas de secrets/tokens/mots de passe dans les logs ; futures API externes appelées depuis le backend avec timeout et gestion d'erreurs.
- Base externe : PostgreSQL managé via `DATABASE_URL` (`DB_SSL=true` en production ; `DB_SSL_REJECT_UNAUTHORIZED=false` uniquement pour les URL internes Render, certificats auto-signés documentés). Dev : `npm run dev` directement. Prod : `NODE_ENV=production`, `npm run build` + `npm start`, écoute `0.0.0.0` sur `PORT`.

## Commandes (vérifiées, depuis `DTI-Backend/`)

- `npm run dev` (watch), `npm start` (compilé), `npm run build`, `npm run typecheck`.
- `npm run lint` / `lint:fix`, `npm run format` / `format:check`.
- `npm test` / `test:watch` (base de test requise, suite séquentielle).
- `npm run db:migrate` / `db:migrate:undo` / `db:migrate:status`, `npm run db:seed`.
- Déploiement : sans Docker — `npm ci && npm run build` puis `npm start` (`NODE_ENV=production`) ; migrations automatiques au boot, manuelles via `DATABASE_URL='<url>' npm run db:migrate`.
