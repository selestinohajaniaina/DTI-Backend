import { sequelize } from '../config/database';
import { env } from '../config/env';
import { DEV_SEED_EMAIL, seedDevelopment } from '../seeders/dev.seed';

async function main(): Promise<void> {
  if (env.isProduction && !env.allowSeedInProduction) {
    console.error('Refusing to seed in production. Set ALLOW_SEED_IN_PRODUCTION=true to override.');
    process.exitCode = 1;
    return;
  }
  try {
    const result = await seedDevelopment();
    console.log(
      result.created
        ? `created demo user ${DEV_SEED_EMAIL} (password: ChangeMe123!)`
        : `demo user ${DEV_SEED_EMAIL} already exists`,
    );
  } finally {
    await sequelize.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
