import { createApp } from './app';
import { sequelize, waitForDatabase } from './config/database';
import { env } from './config/env';
import { createMigrator } from './config/umzug';
import { logger } from './utils/logger';

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
