import { Sequelize } from 'sequelize';
import { env } from './env';
import { logger } from '../utils/logger';
import { initModels } from '../models/index';

export const sequelize = new Sequelize(env.databaseUrl, {
  dialect: 'postgres',
  // SQL logging is opt-in because query text can contain sensitive values.
  logging: env.dbLogging ? (sql: string) => logger.debug('sequelize', { sql }) : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: env.dbSsl
    ? { ssl: { require: true, rejectUnauthorized: env.dbSslRejectUnauthorized } }
    : {},
});

initModels(sequelize);

/** Single-shot connectivity check used by the readiness probe. */
export async function checkDatabase(): Promise<void> {
  await sequelize.authenticate();
}

const STARTUP_ATTEMPTS = 10;
const RETRY_DELAY_MS = 2000;

/**
 * Waits for PostgreSQL during startup (covers provider cold starts and
 * deploy-time ordering races). Throws after the attempts run out.
 */
export async function waitForDatabase(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= STARTUP_ATTEMPTS; attempt += 1) {
    try {
      await sequelize.authenticate();
      logger.info('database connection established');
      return;
    } catch (error) {
      lastError = error;
      // Attempt counts only: driver errors may echo connection details.
      logger.warn('database connection failed, retrying', {
        attempt,
        maxAttempts: STARTUP_ATTEMPTS,
      });
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not connect to the database');
}
