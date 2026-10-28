import { afterAll, beforeAll, beforeEach } from 'vitest';
import { sequelize } from '../src/config/database';
import { env } from '../src/config/env';
import { createMigrator } from '../src/config/umzug';
import { GeneratedIdea } from '../src/models/generated-idea.model';
import { SourceObject } from '../src/models/source-object.model';
import { User } from '../src/models/user.model';
import { testMigrations } from './migration-list';

// Importing src/config/env already fails fast unless TEST_DATABASE_URL points
// to a dedicated test database (name containing "test").
beforeAll(async () => {
  if (!env.isTest) {
    throw new Error('Tests must run with NODE_ENV=test');
  }
  const migrator = createMigrator(sequelize, testMigrations);
  await migrator.up();
});

beforeEach(async () => {
  await GeneratedIdea.destroy({ where: {} });
  await SourceObject.destroy({ where: {} });
  await User.destroy({ where: {} });
});

afterAll(async () => {
  await sequelize.close();
});
