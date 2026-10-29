import { DataTypes, Model } from 'sequelize';
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize,
} from 'sequelize';

/** JSON shapes stored in JSONB columns (kept local: models never import services). */
export interface StoredTutorialStep {
  step: number;
  title: string;
  description: string;
}

/** Canonical shape: every new write uses this (see README). */
export interface StoredMarketPriceEstimate {
  status: 'estimated';
  currency: 'MGA';
  estimatedCost: number | null;
  estimatedSellingPrice: number | null;
}

/** Estimate shape with an MGA suffix, briefly written before standardization. */
export interface StoredMarketPriceEstimateMGA {
  status: 'estimated' | 'unavailable';
  currency: 'MGA';
  estimatedCostMGA: number | null;
  estimatedSellingPriceMGA: number | null;
}

/** Estimate shape with a USD suffix, briefly written before standardization. */
export interface StoredMarketPriceEstimateUSD {
  status: 'estimated' | 'unavailable';
  currency: 'USD';
  estimatedCostUSD: number | null;
  estimatedSellingPriceUSD: number | null;
}

/** Legacy shape written before AI estimation; old rows remain readable. */
export interface StoredMarketPriceLegacy {
  status: 'not_found';
  amount: null;
  currency: null;
  sourceUrl: null;
  listingTitle: null;
}

export type StoredMarketPrice =
  | StoredMarketPriceEstimate
  | StoredMarketPriceEstimateMGA
  | StoredMarketPriceEstimateUSD
  | StoredMarketPriceLegacy;

/**
 * Canonical API shape. Currency is preserved per row (a legacy USD row keeps
 * 'USD' so its amounts are never mislabeled); all new writes use 'MGA'.
 */
export interface NormalizedMarketPrice {
  status: 'estimated';
  currency: string;
  estimatedCost: number | null;
  estimatedSellingPrice: number | null;
}

function storedAmount(row: Record<string, unknown>, key: string): number | null {
  const value: unknown = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

/**
 * Maps any stored `marketPrice` value (current or legacy shape) to the
 * canonical API contract, so previously saved ideas stay displayable without
 * rewriting production data. Missing or malformed values degrade to null
 * estimates rather than throwing.
 */
export function normalizeStoredMarketPrice(value: unknown): NormalizedMarketPrice {
  const empty = (currency: string): NormalizedMarketPrice => ({
    status: 'estimated',
    currency,
    estimatedCost: null,
    estimatedSellingPrice: null,
  });
  if (typeof value !== 'object' || value === null) {
    return empty('MGA');
  }
  const row = value as Record<string, unknown>;
  if ('estimatedCost' in row || 'estimatedSellingPrice' in row) {
    return {
      status: 'estimated',
      currency: 'MGA',
      estimatedCost: storedAmount(row, 'estimatedCost'),
      estimatedSellingPrice: storedAmount(row, 'estimatedSellingPrice'),
    };
  }
  if ('estimatedCostMGA' in row || 'estimatedSellingPriceMGA' in row) {
    return {
      status: 'estimated',
      currency: 'MGA',
      estimatedCost: storedAmount(row, 'estimatedCostMGA'),
      estimatedSellingPrice: storedAmount(row, 'estimatedSellingPriceMGA'),
    };
  }
  if ('estimatedCostUSD' in row || 'estimatedSellingPriceUSD' in row) {
    return {
      status: 'estimated',
      currency: 'USD',
      estimatedCost: storedAmount(row, 'estimatedCostUSD'),
      estimatedSellingPrice: storedAmount(row, 'estimatedSellingPriceUSD'),
    };
  }
  // `not_found` rows and anything unrecognized carry no estimates.
  return empty('MGA');
}

export class GeneratedIdea extends Model<
  InferAttributes<GeneratedIdea>,
  InferCreationAttributes<GeneratedIdea>
> {
  declare id: CreationOptional<string>;
  declare sourceObjectId: string;
  declare title: string;
  declare description: string;
  declare intendedUse: string;
  declare additionalMaterials: string[];
  declare tools: string[];
  declare difficulty: string;
  declare estimatedMinutes: number;
  declare tutorialSteps: StoredTutorialStep[];
  declare safetyNotes: string[];
  // Null when this idea's image generation failed (see imageStatus).
  declare imagePath: string | null;
  declare imageStatus: string;
  declare marketPrice: StoredMarketPrice;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initGeneratedIdeaModel(sequelize: Sequelize): void {
  GeneratedIdea.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      sourceObjectId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'source_objects', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      intendedUse: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      additionalMaterials: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      tools: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      difficulty: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['Easy', 'Medium', 'Hard']] },
      },
      estimatedMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 1440 },
      },
      tutorialSteps: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      safetyNotes: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      imagePath: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      imageStatus: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['completed', 'failed']] },
      },
      marketPrice: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'GeneratedIdea',
      tableName: 'generated_ideas',
      timestamps: true,
    },
  );
}
