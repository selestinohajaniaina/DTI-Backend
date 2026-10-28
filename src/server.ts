import { createApp } from './app';
import { sequelize, waitForDatabase } from './config/database';
import { env } from './config/env';
import { findUncoveredMigrations, type InlineMigration } from './config/umzug';
import { logger } from './utils/logger';

/**
 * Pre-listen startup checks. Migrations are applied exclusively by
 * `npm run db:migrate` during deployment (Render runs it before `npm start`,
 * so a migration failure already prevents startup); the server never applies
 * migrations itself, it only verifies the schema is current and refuses to
 * boot behind it. Exported for tests; `migrations` lets tests pass
 * statically imported files (Umzug's glob cannot load raw `.ts` files under
 * Vitest, so tests pass `tests/migration-list.ts`).
 */
export async function runStartupChecks(migrations?: InlineMigration[]): Promise<void> {
  await waitForDatabase();
  const uncovered = await findUncoveredMigrations(sequelize, migrations);
  if (uncovered.length > 0) {
    throw new Error(
      `Database schema is behind by ${uncovered.length} migration(s) (${uncovered.join(', ')}). ` +
        'Run `npm run db:migrate` before starting the server.',
    );
  }
}

async function main(): Promise<void> {
  logger.info('starting dti backend', { nodeEnv: env.nodeEnv, port: env.port });
  if (
    env.isProduction &&
    (env.host === '127.0.0.1' || env.host === 'localhost' || env.host === '::1')
  ) {
    // Binding loopback in production makes the service unreachable from the
    // hosting load balancer (surfaces as 502 Bad Gateway on Render). Leave
    // HOST unset so it defaults to 0.0.0.0.
    logger.warn('production server bound to a loopback host; use 0.0.0.0', {
      host: env.host,
    });
  }
  await runStartupChecks();
  logger.info('database schema verified up to date');

  const app = createApp();
  const server = app.listen(env.port, env.host, () => {
    logger.info('server listening', { host: env.host, port: env.port });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(() => {
      void sequelize.close().finally(() => process.exit(0));
    });
    // Force exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Importing this module (e.g. from tests) must not start the server.
const invokedDirectly =
  typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;
if (invokedDirectly) {
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('unhandled rejection', { error: reason });
  });

  void main().catch((error: unknown) => {
    logger.error('failed to start server', { error });
    // Release pooled connections so a failed boot exits promptly instead of
    // hanging on open handles (Render would only see a deploy timeout).
    void sequelize
      .close()
      .catch(() => undefined)
      .finally(() => {
        process.exitCode = 1;
      });
  });
}
