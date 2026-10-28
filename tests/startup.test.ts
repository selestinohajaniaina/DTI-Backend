import { describe, expect, it } from 'vitest';
import { sequelize } from '../src/config/database';
import { runStartupChecks } from '../src/server';
import { runCommand } from '../src/scripts/migrate';
import { freshDb, historyNames, restoreMigratedState, tableNames } from './db-helpers';
import { testMigrations } from './migration-list';

// The server never applies migrations: deployment runs `db:migrate` first and
// boot only verifies coverage. Every test restores the pristine migrated
// state, so this file is safe to run in any position of the suite.

describe('runStartupChecks', () => {
  it('passes on a fully migrated database', async () => {
    await expect(runStartupChecks(testMigrations)).resolves.toBeUndefined();
  });

  it('applies nothing during startup: deployment migrates exactly once', async () => {
    const before = freshDb();
    let historyBefore: string[];
    let tablesBefore: string[];
    try {
      historyBefore = await historyNames(before);
      tablesBefore = await tableNames(before);
    } finally {
      await before.close();
    }

    // Simulate the deployment sequence: migrate, then boot.
    expect(await runCommand('up', freshDb(), testMigrations)).toBe(0);
    await expect(runStartupChecks(testMigrations)).resolves.toBeUndefined();

    const after = freshDb();
    try {
      expect(await historyNames(after)).toEqual(historyBefore);
      expect(await tableNames(after)).toEqual(tablesBefore);
    } finally {
      await after.close();
    }
  });

  it('refuses to boot when the schema is behind', async () => {
    const ideas = testMigrations.find((migration) => migration.name.includes('generated-ideas'));
    if (!ideas) {
      throw new Error('test setup broken: generated-ideas migration missing');
    }
    try {
      await sequelize.query('DROP TABLE IF EXISTS "generated_ideas" CASCADE;');
      await sequelize.query(`DELETE FROM "SequelizeMeta" WHERE name = '${ideas.name}';`);

      await expect(runStartupChecks(testMigrations)).rejects.toThrow(/behind.*db:migrate/s);
    } finally {
      await restoreMigratedState();
    }
  });

  it('tolerates history recorded under the other file extension', async () => {
    const users = testMigrations.find((migration) => migration.name.includes('create-users'));
    if (!users) {
      throw new Error('test setup broken: create-users migration missing');
    }
    const jsName = users.name.replace(/\.ts$/, '.js');
    try {
      // Same migration as production boot sees it: schema present, history
      // row stored with the other runner's extension.
      await sequelize.query(`DELETE FROM "SequelizeMeta" WHERE name = '${users.name}';`);
      await sequelize.query(`INSERT INTO "SequelizeMeta" ("name") VALUES ('${jsName}');`);

      await expect(runStartupChecks(testMigrations)).resolves.toBeUndefined();
    } finally {
      await sequelize.query(`DELETE FROM "SequelizeMeta" WHERE name = '${jsName}';`);
      await sequelize.query(`INSERT INTO "SequelizeMeta" ("name") VALUES ('${users.name}');`);
    }
  });
});
