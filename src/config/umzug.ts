import path from 'node:path';
import type { Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import type { MigrationFn } from 'umzug';

export interface InlineMigration {
  name: string;
  up: MigrationFn<Sequelize>;
  down?: MigrationFn<Sequelize>;
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
