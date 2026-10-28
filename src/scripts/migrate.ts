import type { Sequelize } from 'sequelize';
import { sequelize } from '../config/database';
import { createMigrator, type InlineMigration } from '../config/umzug';

type Command = 'up' | 'down' | 'status';

function parseCommand(raw: string | undefined): Command | undefined {
  if (raw === 'up' || raw === 'down' || raw === 'status') {
    return raw;
  }
  return undefined;
}

// PostgreSQL duplicate-object codes, independent of the server locale
// (error messages may be translated, codes are not).
const DUPLICATE_TABLE_CODE = '42P07';
const DUPLICATE_COLUMN_CODE = '42701';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Walks `cause` chains (Umzug wraps failures in MigrationError) looking for
 * evidence that the schema already contains objects a migration wants to
 * create. Returns a short description, or undefined for unrelated errors.
 */
function findAlreadyExistsEvidence(error: unknown): string | undefined {
  const seen = new Set<Record<string, unknown>>();
  let current: unknown = error;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    const parent: unknown = current['parent'];
    if (isRecord(parent) && typeof parent['code'] === 'string') {
      if (parent['code'] === DUPLICATE_TABLE_CODE || parent['code'] === DUPLICATE_COLUMN_CODE) {
        return `PostgreSQL error ${parent['code']} (object already exists)`;
      }
    }
    if (current instanceof Error && /already exists/i.test(current.message)) {
      return current.message;
    }
    current = current['cause'];
  }
  return undefined;
}

function stripMigrationExtension(name: string): string {
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

/**
 * Reads raw history rows. Unlike `migrator.executed()`, this also returns
 * rows Umzug no longer recognizes (e.g. `.ts` names when running compiled
 * `.js` migrations), which is exactly the inconsistency we must detect.
 */
async function readRecordedMigrationNames(db: Sequelize): Promise<string[]> {
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

function printExtensionMismatchGuidance(mismatch: ExtensionMismatch): void {
  console.error('Migration history mismatch: the same migration is recorded under a');
  console.error('different file name. Nothing was applied.');
  console.error(`  recorded as executed: ${mismatch.recorded}`);
  console.error(`  now seen as pending:  ${mismatch.pending}`);
  console.error('Common cause: `npm run db:migrate` (tsx) records `.ts` names while the');
  console.error('compiled server records `.js` names. Reconcile safely:');
  console.error('  1. Back up the database.');
  console.error('  2. Confirm the schema is complete (`npm run db:migrate:status`, psql \\dt).');
  console.error('  3. If it is, record the missing history rows explicitly instead of');
  console.error('     re-applying, e.g. INSERT INTO "SequelizeMeta" ("name") VALUES (...);');
  console.error('  4. Then keep one runner per database (tsx for development, compiled');
  console.error('     output for production).');
}

function printSchemaMismatchGuidance(evidence: string): void {
  console.error('Migration failed: the database schema disagrees with the migration history.');
  console.error(`Cause: ${evidence}`);
  console.error('A pending migration wants to create objects that already exist, but no');
  console.error('recorded migration created them. Possible causes: history recorded under');
  console.error('different file names (`.ts` vs `.js` runners, see above), hand-made tables,');
  console.error('or a previously interrupted run. Nothing further was applied. Reconcile safely:');
  console.error('  1. Back up the database.');
  console.error('  2. Compare `npm run db:migrate:status` with the real schema (psql \\dt).');
  console.error('  3. If the schema already matches, record the missing "SequelizeMeta" rows');
  console.error('     explicitly; otherwise complete or remove the conflicting objects');
  console.error('     manually, then re-run.');
}

/**
 * Runs one migrate command, returning the process exit code. Exported for
 * tests; `db` and `migrations` let tests use an isolated connection and
 * statically imported migrations (Umzug's glob cannot load raw `.ts` files
 * under Vitest, so tests pass the same list as `tests/setup.ts`).
 */
export async function runCommand(
  raw: string | undefined,
  db: Sequelize = sequelize,
  migrations?: InlineMigration[],
): Promise<number> {
  const command = parseCommand(raw);
  if (!command) {
    console.error(`Unknown command: ${raw ?? '(none)'} (expected up|down|status)`);
    await db.close();
    return 1;
  }
  const migrator = createMigrator(db, migrations);
  try {
    if (command === 'up') {
      // Sequential on purpose: Umzug syncs its storage table on first use and
      // concurrent calls race the CREATE TABLE on a fresh database.
      const pending = await migrator.pending();
      const recorded = await readRecordedMigrationNames(db);
      const mismatch = findExtensionMismatch(
        recorded.map((name) => ({ name })),
        pending,
      );
      if (mismatch) {
        printExtensionMismatchGuidance(mismatch);
        return 1;
      }
      try {
        const applied = await migrator.up();
        for (const migration of applied) {
          console.log(`applied: ${migration.name}`);
        }
        if (applied.length === 0) {
          console.log('database is up to date');
        }
        return 0;
      } catch (error: unknown) {
        const evidence = findAlreadyExistsEvidence(error);
        if (evidence !== undefined) {
          printSchemaMismatchGuidance(evidence);
          return 1;
        }
        throw error;
      }
    }
    if (command === 'down') {
      const executed = await migrator.executed();
      if (executed.length === 0) {
        console.log('nothing to revert');
      } else {
        const last = executed[executed.length - 1];
        // Revert exactly the newest migration. Umzug's `to` is inclusive:
        // passing the previous migration would revert two.
        const reverted = await migrator.down({ to: last?.name ?? 0 });
        for (const migration of reverted) {
          console.log(`reverted: ${migration.name}`);
        }
        if (reverted.length === 0 && last) {
          console.log(`reverted: ${last.name}`);
        }
      }
      return 0;
    }
    // Sequential on purpose: Umzug syncs its storage table on first use and
    // concurrent calls race the CREATE TABLE on a fresh database.
    const executed = await migrator.executed();
    const pending = await migrator.pending();
    console.log(`executed (${executed.length}):`);
    for (const migration of executed) {
      console.log(`  - ${migration.name}`);
    }
    console.log(`pending (${pending.length}):`);
    for (const migration of pending) {
      console.log(`  - ${migration.name}`);
    }
    return 0;
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runCommand(process.argv[2]);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

// Importing this module (e.g. from tests) must not run the CLI: it would
// parse the importer's argv and close the shared test connection.
const invokedDirectly =
  typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;
if (invokedDirectly) {
  void main();
}
