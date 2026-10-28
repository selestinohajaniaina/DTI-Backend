import path from 'node:path';
import type { Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import type { MigrationFn } from 'umzug';

export interface InlineMigration {
  name: string;
  up: MigrationFn<Sequelize>;
  down?: MigrationFn<Sequelize>;
}

export function stripMigrationExtension(name: string): string {
  return name.replace(/\.(ts|js)$/, '');
}

export interface ExtensionMismatch {
  pending: string;
  recorded: string;
}

/**
 * Detects history recorded under a different file extension than the pending
 * files: `npm run db:migrate` (tsx) records `.ts` names while the compiled
 * server records `.js` names, and Umzug treats those as different entries.
 */
export function findExtensionMismatch(
  recorded: readonly { name: string }[],
  pending: readonly { name: string }[],
): ExtensionMismatch | undefined {
  const recordedBase = new Map<string, string>();
  for (const migration of recorded) {
    recordedBase.set(stripMigrationExtension(migration.name), migration.name);
  }
  for (const migration of pending) {
    const counterpart = recordedBase.get(stripMigrationExtension(migration.name));
    if (counterpart !== undefined && counterpart !== migration.name) {
      return { pending: migration.name, recorded: counterpart };
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads raw history rows. Unlike `migrator.executed()`, this also returns
 * rows Umzug no longer recognizes (e.g. `.ts` names when running compiled
 * `.js` migrations), which is exactly the inconsistency we must detect.
 */
export async function readRecordedMigrationNames(db: Sequelize): Promise<string[]> {
  try {
    const [rows] = await db.query('SELECT name FROM "SequelizeMeta" ORDER BY name;');
    return (rows as { name: string }[]).map((row) => row.name);
  } catch (error: unknown) {
    if (isRecord(error) && isRecord(error['parent']) && error['parent']['code'] === '42P01') {
      // Fresh database: the storage table does not exist yet.
      return [];
    }
    throw error;
  }
}

/**
 * Returns pending migration names with no history row under any extension.
 * Empty means the schema is fully migrated. Unlike a plain `pending()`
 * check, this tolerates history recorded by the other runner (`.ts` vs
 * `.js`) as long as the migration itself is covered, so a read-only boot
 * check never blocks on a naming difference alone. Never writes anything.
 */
export async function findUncoveredMigrations(
  db: Sequelize,
  migrations?: InlineMigration[],
): Promise<string[]> {
  const migrator = createMigrator(db, migrations);
  // Sequential on purpose: storage calls must not race (see migrate.ts).
  const pending = await migrator.pending();
  if (pending.length === 0) {
    return [];
  }
  const recorded = await readRecordedMigrationNames(db);
  const recordedBase = new Set(recorded.map(stripMigrationExtension));
  return pending
    .map((migration) => migration.name)
    .filter((name) => !recordedBase.has(stripMigrationExtension(name)));
}

export function createMigrator(
  sequelize: Sequelize,
  migrations?: InlineMigration[],
): Umzug<Sequelize> {
  // Sources live in src/migrations/*.ts, compiled output in dist/migrations/*.js.
  // The glob is resolved from this file's own location so both layouts work.
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const pattern = __filename.endsWith('.ts') ? '*.ts' : '*.js';
  const noop = (): void => undefined;
  return new Umzug({
    migrations: migrations ?? {
      glob: path.join(migrationsDir, pattern).replace(/\\/g, '/'),
    },
    context: sequelize,
    storage: new SequelizeStorage({ sequelize }),
    // Callers log migration results themselves; keep Umzug quiet.
    logger: { info: noop, warn: noop, error: noop, debug: noop },
  });
}
