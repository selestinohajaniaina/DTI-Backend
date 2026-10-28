import { afterAll, beforeAll, beforeEach } from 'vitest';
import { sequelize } from '../src/config/database';
import { env } from '../src/config/env';
import { createMigrator } from '../src/config/umzug';
import {
  down as createUsersDown,
  up as createUsersUp,
} from '../src/migrations/20261027000001-create-users';
import {
  down as createSourceObjectsDown,
  up as createSourceObjectsUp,
} from '../src/migrations/20261028000001-create-source-objects';
import {
  down as createGeneratedIdeasDown,
  up as createGeneratedIdeasUp,
} from '../src/migrations/20261028000002-create-generated-ideas';
import { GeneratedIdea } from '../src/models/generated-idea.model';
import { SourceObject } from '../src/models/source-object.model';
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
    {
      name: '20261028000001-create-source-objects.ts',
      up: createSourceObjectsUp,
      down: createSourceObjectsDown,
    },
    {
      name: '20261028000002-create-generated-ideas.ts',
      up: createGeneratedIdeasUp,
      down: createGeneratedIdeasDown,
    },
  ]);
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
