import type { InlineMigration } from '../src/config/umzug';
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
import {
  down as convertMarketPriceToUsdDown,
  up as convertMarketPriceToUsdUp,
} from '../src/migrations/20261030000001-convert-market-price-to-usd';

// Migrations imported statically (so Vitest transforms them) instead of
// Umzug's runtime glob import, which cannot load raw .ts files. Add future
// migrations to this list in filename order.
export const testMigrations: InlineMigration[] = [
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
  {
    name: '20261030000001-convert-market-price-to-usd.ts',
    up: convertMarketPriceToUsdUp,
    down: convertMarketPriceToUsdDown,
  },
];
