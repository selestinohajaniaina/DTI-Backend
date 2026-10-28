import { Sequelize } from 'sequelize';
import { env } from '../src/config/env';
import { runCommand } from '../src/scripts/migrate';
import { testMigrations } from './migration-list';

export function freshDb(): Sequelize {
  return new Sequelize(env.databaseUrl, { dialect: 'postgres', logging: false });
}

export async function historyNames(db: Sequelize): Promise<string[]> {
  const [rows] = await db.query('SELECT name FROM "SequelizeMeta" ORDER BY name;');
  return (rows as { name: string }[]).map((row) => row.name);
}

export async function tableNames(db: Sequelize): Promise<string[]> {
  const [rows] = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`,
  );
  return (rows as { table_name: string }[]).map((row) => row.table_name);
}

/**
 * Drops all app tables and re-applies every migration, restoring the
 * pristine migrated state for the rest of the suite.
 */
export async function restoreMigratedState(): Promise<void> {
  const db = freshDb();
  try {
    await db.query('DROP TABLE IF EXISTS "generated_ideas", "source_objects", "users" CASCADE;');
    await db.query('DELETE FROM "SequelizeMeta";');
    const code = await runCommand('up', db, testMigrations);
    if (code !== 0) {
      throw new Error('test restore failed to re-apply migrations');
    }
  } finally {
    await db.close().catch(() => undefined);
  }
}
