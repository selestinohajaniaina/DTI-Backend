import { createApp } from './app';
import { sequelize, waitForDatabase } from './config/database';
import { env } from './config/env';
import { createMigrator } from './config/umzug';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  logger.info('starting dti backend', { nodeEnv: env.nodeEnv, port: env.port });
  await waitForDatabase();

  const migrator = createMigrator(sequelize);
  const applied = await migrator.up();
  logger.info('database migrations complete', { applied: applied.length });

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

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('unhandled rejection', { error: reason });
});

void main().catch((error: unknown) => {
  logger.error('failed to start server', { error });
  process.exitCode = 1;
});
