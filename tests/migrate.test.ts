import { describe, expect, it, vi } from 'vitest';
import { findExtensionMismatch } from '../src/config/umzug';
import { runCommand } from '../src/scripts/migrate';
import { freshDb, historyNames, restoreMigratedState } from './db-helpers';
import { testMigrations } from './migration-list';

// Every test uses an isolated connection and leaves the shared test database
// fully migrated, so this file is safe to run in any position of the suite.

function silencedErrors(): { spy: { mock: { calls: unknown[][] } }; restore: () => void } {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return {
    spy: { mock: { calls: spy.mock.calls as unknown[][] } },
    restore: () => spy.mockRestore(),
  };
}

function spyText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => args.map((arg) => String(arg)).join(' ')).join('\n');
}

describe('findExtensionMismatch', () => {
  it('detects history recorded under the other file extension', () => {
    expect(
      findExtensionMismatch(
        [{ name: '20261027000001-create-users.ts' }],
        [{ name: '20261027000001-create-users.js' }],
      ),
    ).toEqual({
      pending: '20261027000001-create-users.js',
      recorded: '20261027000001-create-users.ts',
    });
    expect(
      findExtensionMismatch(
        [{ name: '20261027000001-create-users.js' }],
        [{ name: '20261027000001-create-users.ts' }],
      ),
    ).toEqual({
      pending: '20261027000001-create-users.ts',
      recorded: '20261027000001-create-users.js',
    });
  });

  it('returns undefined when history and files agree', () => {
    expect(findExtensionMismatch([], [])).toBeUndefined();
    expect(
      findExtensionMismatch(
        [{ name: '20261027000001-create-users.ts' }],
        [{ name: '20261028000001-create-source-objects.ts' }],
      ),
    ).toBeUndefined();
  });
});

describe('runCommand', () => {
  it('succeeds when the database is already up to date', async () => {
    const db = freshDb();

    await expect(runCommand('up', db, testMigrations)).resolves.toBe(0);
    // The connection is closed on the success path.
    await expect(db.authenticate()).rejects.toThrow();
  });

  it('applies and records a pending migration', async () => {
    expect(await runCommand('down', freshDb(), testMigrations)).toBe(0);
    const probe = freshDb();
    try {
      expect(await historyNames(probe)).toHaveLength(3);
    } finally {
      await probe.close();
    }

    expect(await runCommand('up', freshDb(), testMigrations)).toBe(0);
    const db = freshDb();
    try {
      expect(await historyNames(db)).toHaveLength(4);
    } finally {
      await db.close();
    }
  });

  it('reports schema/history mismatches without applying further changes', async () => {
    const { spy, restore } = silencedErrors();
    const db = freshDb();
    try {
      // Simulate lost history: schema stays, tracking rows go away.
      await db.query('DELETE FROM "SequelizeMeta";');

      const code = await runCommand('up', db, testMigrations);

      expect(code).toBe(1);
      const output = spyText(spy);
      expect(output).toContain('disagrees with the migration history');
      expect(output).toContain('SequelizeMeta');
      expect(output).toContain('Back up');
      // The connection is closed on the failure path too.
      await expect(db.authenticate()).rejects.toThrow();
    } finally {
      restore();
      await restoreMigratedState();
    }
  });

  it('refuses to apply over history recorded under another extension', async () => {
    const { spy, restore } = silencedErrors();
    const db = freshDb();
    try {
      // Simulate a mixed-runner database: schema present, but history holds
      // a `.js` name while the pending files use `.ts` names.
      await db.query('DELETE FROM "SequelizeMeta";');
      await db.query(
        `INSERT INTO "SequelizeMeta" ("name") VALUES ('20261027000001-create-users.js');`,
      );

      const code = await runCommand('up', db, testMigrations);

      expect(code).toBe(1);
      const output = spyText(spy);
      expect(output).toContain('different file name');
      expect(output).toContain('20261027000001-create-users.js');
      // Nothing was applied: history still holds only the planted row.
      // (`db` was closed by runCommand, so probe with a fresh connection.)
      const probe = freshDb();
      try {
        expect(await historyNames(probe)).toEqual(['20261027000001-create-users.js']);
      } finally {
        await probe.close();
      }
    } finally {
      restore();
      await restoreMigratedState();
    }
  });

  it('rejects unknown commands with a non-zero code', async () => {
    const { spy, restore } = silencedErrors();
    const db = freshDb();
    try {
      expect(await runCommand('bogus', db)).toBe(1);
      expect(spyText(spy)).toContain('Unknown command');
      await expect(db.authenticate()).rejects.toThrow();
    } finally {
      restore();
    }
  });
});
