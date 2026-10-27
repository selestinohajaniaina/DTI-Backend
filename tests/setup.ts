import { afterAll, beforeAll, beforeEach } from 'vitest';
import { sequelize } from '../src/config/database';
import { env } from '../src/config/env';
import { createMigrator } from '../src/config/umzug';
import {
  down as createUsersDown,
  up as createUsersUp,
} from '../src/migrations/20261027000001-create-users';
import { User } from '../src/models/user.model';

// Importing src/config/env already fails fast unless TEST_DATABASE_URL points
// to a dedicated test database (name containing "test").
beforeAll(async () => {
  if (!env.isTest) {
    throw new Error('Tests must run with NODE_ENV=test');
  }
  // Migrations are imported statically (so Vitest transforms them) instead of
  // Umzug's runtime glob import, which cannot load raw .ts files. Add future
  // migrations to this list in filename order.
  const migrator = createMigrator(sequelize, [
    { name: '20261027000001-create-users.ts', up: createUsersUp, down: createUsersDown },
  ]);
  await migrator.up();
});

beforeEach(async () => {
  await User.destroy({ where: {} });
});

afterAll(async () => {
  await sequelize.close();
});
