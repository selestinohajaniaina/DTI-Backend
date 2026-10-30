import { DataTypes } from 'sequelize';
import type { Sequelize } from 'sequelize';
import type { MigrationFn } from 'umzug';

/**
 * Converts stored `marketPrice` estimates from Malagasy Ariary (MGA) to US
 * dollars (USD).
 *
 * Rate: 1 USD = 4512.52 MGA (ExchangeRatesNow.com USD/MGA reference rate
 * published 2026-10-26, retrieved 2026-10-30:
 * https://www.exchangeratesnow.com/exchange-rates/?from=USD&to=MGA).
 * Converted amounts are rounded to cents; JSON nulls and non-numeric values
 * stay null.
 *
 * Safety: every touched row keeps its exact pre-conversion JSON in the new
 * `marketPriceMga` archive column, so `down` restores the original data
 * byte-for-byte instead of inverting the rate (which would lose cents to
 * rounding). Rows already in canonical USD shape and `not_found` legacy
 * rows are left untouched. New writes always use the canonical USD shape.
 */
const MGA_PER_USD = 4512.52;

const CONVERT_MGA_TO_USD = `
UPDATE "generated_ideas"
SET "marketPriceMga" = "marketPrice",
  "marketPrice" = jsonb_build_object(
    'status', 'estimated',
    'currency', 'USD',
    'estimatedCost', CASE
      WHEN jsonb_typeof(COALESCE("marketPrice"->'estimatedCost', "marketPrice"->'estimatedCostMGA')) = 'number'
      THEN ROUND((COALESCE("marketPrice"->'estimatedCost', "marketPrice"->'estimatedCostMGA')::text)::numeric / ${MGA_PER_USD}, 2)
      ELSE NULL END,
    'estimatedSellingPrice', CASE
      WHEN jsonb_typeof(COALESCE("marketPrice"->'estimatedSellingPrice', "marketPrice"->'estimatedSellingPriceMGA')) = 'number'
      THEN ROUND((COALESCE("marketPrice"->'estimatedSellingPrice', "marketPrice"->'estimatedSellingPriceMGA')::text)::numeric / ${MGA_PER_USD}, 2)
      ELSE NULL END
  )
WHERE "marketPrice"->>'currency' = 'MGA';
`;

const CANONICALIZE_USD_SUFFIXED = `
UPDATE "generated_ideas"
SET "marketPriceMga" = "marketPrice",
  "marketPrice" = jsonb_build_object(
    'status', 'estimated',
    'currency', 'USD',
    'estimatedCost', CASE
      WHEN jsonb_typeof(("marketPrice"->'estimatedCostUSD')) = 'number'
      THEN (("marketPrice"->'estimatedCostUSD')::text)::numeric
      ELSE NULL END,
    'estimatedSellingPrice', CASE
      WHEN jsonb_typeof(("marketPrice"->'estimatedSellingPriceUSD')) = 'number'
      THEN (("marketPrice"->'estimatedSellingPriceUSD')::text)::numeric
      ELSE NULL END
  )
WHERE ("marketPrice" ? 'estimatedCostUSD' OR "marketPrice" ? 'estimatedSellingPriceUSD');
`;

const RESTORE_ARCHIVED = `
UPDATE "generated_ideas"
SET "marketPrice" = "marketPriceMga"
WHERE "marketPriceMga" IS NOT NULL;
`;

export const up: MigrationFn<Sequelize> = async ({ context }) => {
  const queryInterface = context.getQueryInterface();
  await queryInterface.addColumn('generated_ideas', 'marketPriceMga', {
    type: DataTypes.JSONB,
    allowNull: true,
  });
  await context.query(CONVERT_MGA_TO_USD);
  await context.query(CANONICALIZE_USD_SUFFIXED);
};

export const down: MigrationFn<Sequelize> = async ({ context }) => {
  await context.query(RESTORE_ARCHIVED);
  await context.getQueryInterface().removeColumn('generated_ideas', 'marketPriceMga');
};
