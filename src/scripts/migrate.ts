import { sequelize } from '../config/database';
import { createMigrator } from '../config/umzug';

type Command = 'up' | 'down' | 'status';

function parseCommand(raw: string | undefined): Command | undefined {
  if (raw === 'up' || raw === 'down' || raw === 'status') {
    return raw;
  }
  return undefined;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  if (!command) {
    console.error(`Unknown command: ${process.argv[2] ?? '(none)'} (expected up|down|status)`);
    process.exitCode = 1;
    return;
  }
  const migrator = createMigrator(sequelize);
  try {
    if (command === 'up') {
      const applied = await migrator.up();
      for (const migration of applied) {
        console.log(`applied: ${migration.name}`);
      }
      if (applied.length === 0) {
        console.log('database is up to date');
      }
    } else if (command === 'down') {
      const executed = await migrator.executed();
      if (executed.length === 0) {
        console.log('nothing to revert');
      } else {
        const last = executed[executed.length - 1];
        const previous = executed.length > 1 ? executed[executed.length - 2] : undefined;
        // Revert exactly one migration: everything after `previous` (or all
        // when `previous` does not exist).
        const reverted = await migrator.down({ to: previous?.name ?? 0 });
        for (const migration of reverted) {
          console.log(`reverted: ${migration.name}`);
        }
        if (reverted.length === 0 && last) {
          console.log(`reverted: ${last.name}`);
        }
      }
    } else {
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
    }
  } finally {
    await sequelize.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
