import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sequelize } from '../src/config/database';
import {
  down as convertMarketPriceDown,
  up as convertMarketPriceUp,
} from '../src/migrations/20261030000001-convert-market-price-to-usd';
import { GeneratedIdea, normalizeStoredMarketPrice } from '../src/models/generated-idea.model';
import type { StoredMarketPrice } from '../src/models/generated-idea.model';
import { SourceObject } from '../src/models/source-object.model';

// The suite setup already applies every migration, so this file drives the
// USD conversion directly (down to the pre-migration schema, then up) and
// always leaves the schema fully migrated behind.

const PARAMS = { name: '20261030000001-convert-market-price-to-usd', context: sequelize };

async function seedIdea(title: string, marketPrice: unknown): Promise<void> {
  const source = await SourceObject.create({
    ownerId: null,
    anonymousOwnerId: crypto.randomUUID(),
    imagePath: 'source/cup.png',
    name: 'Cup',
    material: 'plastic',
    condition: 'reusable',
  });
  await GeneratedIdea.create({
    sourceObjectId: source.id,
    title,
    description: 'Description',
    intendedUse: 'Decoration',
    additionalMaterials: [],
    tools: [],
    difficulty: 'Easy',
    estimatedMinutes: 10,
    tutorialSteps: [],
    safetyNotes: [],
    imagePath: null,
    imageStatus: 'failed',
    marketPrice: marketPrice as StoredMarketPrice,
  });
}

async function storedPrices(): Promise<Map<string, { marketPrice: unknown; archive: unknown }>> {
  const rows = await GeneratedIdea.findAll({ order: [['title', 'ASC']] });
  const entries: [string, { marketPrice: unknown; archive: unknown }][] = rows.map((row) => [
    row.title,
    { marketPrice: row.marketPrice, archive: row.marketPriceMga },
  ]);
  return new Map(entries);
}

describe('20261030000001-convert-market-price-to-usd', () => {
  it('converts legacy rows to USD, archives the originals, and restores them on down', async () => {
    const canonicalMga = {
      status: 'estimated',
      currency: 'MGA',
      estimatedCost: 800,
      estimatedSellingPrice: 3000,
    };
    const nullMga = {
      status: 'estimated',
      currency: 'MGA',
      estimatedCost: null,
      estimatedSellingPrice: null,
    };
    const suffixedMga = {
      status: 'estimated',
      currency: 'MGA',
      estimatedCostMGA: 1000,
      estimatedSellingPriceMGA: 5000,
    };
    const suffixedUsd = {
      status: 'estimated',
      currency: 'USD',
      estimatedCostUSD: 5,
      estimatedSellingPriceUSD: 25,
    };
    const canonicalUsd = {
      status: 'estimated',
      currency: 'USD',
      estimatedCost: 2.5,
      estimatedSellingPrice: 8,
    };
    const notFound = {
      status: 'not_found',
      amount: null,
      currency: null,
      sourceUrl: null,
      listingTitle: null,
    };
    await seedIdea('canonical-mga', canonicalMga);
    await seedIdea('null-mga', nullMga);
    await seedIdea('suffixed-mga', suffixedMga);
    await seedIdea('suffixed-usd', suffixedUsd);
    await seedIdea('canonical-usd', canonicalUsd);
    await seedIdea('not-found', notFound);

    // Back to the pre-migration schema first: the suite setup runs every
    // migration, and `up` must add the archive column itself.
    await convertMarketPriceDown(PARAMS);
    await convertMarketPriceUp(PARAMS);

    const converted = await storedPrices();
    // 1 USD = 4512.52 MGA, rounded to cents.
    expect(converted.get('canonical-mga')).toEqual({
      marketPrice: {
        status: 'estimated',
        currency: 'USD',
        estimatedCost: 0.18,
        estimatedSellingPrice: 0.66,
      },
      archive: canonicalMga,
    });
    expect(converted.get('null-mga')).toEqual({
      marketPrice: {
        status: 'estimated',
        currency: 'USD',
        estimatedCost: null,
        estimatedSellingPrice: null,
      },
      archive: nullMga,
    });
    expect(converted.get('suffixed-mga')).toEqual({
      marketPrice: {
        status: 'estimated',
        currency: 'USD',
        estimatedCost: 0.22,
        estimatedSellingPrice: 1.11,
      },
      archive: suffixedMga,
    });
    expect(converted.get('suffixed-usd')).toEqual({
      marketPrice: {
        status: 'estimated',
        currency: 'USD',
        estimatedCost: 5,
        estimatedSellingPrice: 25,
      },
      archive: suffixedUsd,
    });
    // Already-canonical and `not_found` rows are untouched and unarchived.
    expect(converted.get('canonical-usd')).toEqual({
      marketPrice: canonicalUsd,
      archive: null,
    });
    expect(converted.get('not-found')).toEqual({ marketPrice: notFound, archive: null });

    // Converted rows read back through the canonical contract.
    expect(normalizeStoredMarketPrice(converted.get('canonical-mga')?.marketPrice)).toEqual(
      converted.get('canonical-mga')?.marketPrice,
    );

    // `down` restores every original byte-for-byte and drops the column.
    await convertMarketPriceDown(PARAMS);
    const [restored = []] = (await sequelize.query(
      'SELECT title, "marketPrice" FROM "generated_ideas" ORDER BY title;',
    )) as unknown as [{ title: string; marketPrice: unknown }[], unknown];
    const actual = new Map<string, unknown>(restored.map((row) => [row.title, row.marketPrice]));
    expect(actual).toEqual(
      new Map<string, unknown>([
        ['canonical-mga', canonicalMga],
        ['null-mga', nullMga],
        ['suffixed-mga', suffixedMga],
        ['suffixed-usd', suffixedUsd],
        ['canonical-usd', canonicalUsd],
        ['not-found', notFound],
      ]),
    );
    const [columns = []] = await sequelize.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'generated_ideas' AND column_name = 'marketPriceMga';`,
    );
    expect(columns).toHaveLength(0);

    // Leave the schema fully migrated for the rest of the suite.
    await convertMarketPriceUp(PARAMS);
    const reconverted = await storedPrices();
    expect(reconverted.get('canonical-mga')?.marketPrice).toEqual({
      status: 'estimated',
      currency: 'USD',
      estimatedCost: 0.18,
      estimatedSellingPrice: 0.66,
    });
  });
});
